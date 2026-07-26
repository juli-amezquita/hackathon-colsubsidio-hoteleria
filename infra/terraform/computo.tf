data "aws_ami" "al2023_arm" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-kernel-6.1-arm64"]
  }
}

# --------------------------------------------------------------------------
# Rol de la instancia
#
# Sin llaves de acceso en ningún lado: la instancia asume su rol.
# SSM Session Manager reemplaza a SSH — no abre el puerto 22 y no se cae
# cuando el ISP de quien administra rota su IP.
# --------------------------------------------------------------------------
resource "aws_iam_role" "backend" {
  name = "${local.nombre}-backend"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.backend.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "backend" {
  name = "${local.nombre}-backend"
  role = aws_iam_role.backend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "LeerSuPropiaConfiguracion"
        Effect = "Allow"
        Action = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
        # Dos ARN, no uno: `GetParametersByPath` se autoriza contra LA RUTA
        # (`…/cci/mvp`), mientras que `GetParameter` lo hace contra cada
        # parámetro (`…/cci/mvp/*`). Con solo el segundo, la instancia no puede
        # leer su propia configuración al arrancar.
        Resource = [
          "arn:aws:ssm:${var.region}:*:parameter${local.prefijo_ssm}",
          "arn:aws:ssm:${var.region}:*:parameter${local.prefijo_ssm}/*",
        ]
      },
      {
        Sid      = "DescifrarSecretos"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = "*"
        Condition = {
          StringEquals = { "kms:ViaService" = "ssm.${var.region}.amazonaws.com" }
        }
      },
      {
        # Escribe evidencia y exportaciones; NO borra. El bucket es un registro
        # de auditoría, y un registro del que se puede borrar no lo es.
        Sid      = "EscribirEvidencia"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:ListBucket"]
        Resource = [aws_s3_bucket.evidencia.arn, "${aws_s3_bucket.evidencia.arn}/*"]
      },
      {
        Sid      = "PublicarMetricaDeSesiones"
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
        Condition = {
          StringEquals = { "cloudwatch:namespace" = "CapturaInventarios" }
        }
      },
    ]
  })
}

resource "aws_iam_instance_profile" "backend" {
  name = "${local.nombre}-backend"
  role = aws_iam_role.backend.name
}

locals {
  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    prefijo_ssm = local.prefijo_ssm
    region      = var.region
    entorno     = var.entorno
    bucket      = aws_s3_bucket.evidencia.bucket
  })
}

# --------------------------------------------------------------------------
# MVP: una instancia con Docker Compose (D-25)
#
# La API es stateless — sesión en cookie firmada (D-20), caché compartida en
# Redis (D-18) y el audio va del navegador directo a Deepgram (D-07-A). Por eso
# un despliegue es un reemplazo: sin sticky sessions y sin draining.
#
# NO es Lambda porque el worker de pg-boss necesita un proceso residente: el
# despachador del outbox ES el bus de eventos (Principio IV).
# --------------------------------------------------------------------------
resource "aws_instance" "backend" {
  count = var.habilitar_escalado ? 0 : 1

  ami                    = data.aws_ami.al2023_arm.id
  instance_type          = var.tipo_instancia
  subnet_id              = aws_subnet.publica[0].id
  vpc_security_group_ids = [aws_security_group.backend.id]
  iam_instance_profile   = aws_iam_instance_profile.backend.name
  user_data              = local.user_data

  # Cambiar el arranque REEMPLAZA la instancia, y tiene que ser así.
  #
  # Por defecto, Terraform aplica un `user_data` nuevo parando y arrancando la
  # máquina. Parece suficiente y no lo es: cloud-init ejecuta el user_data **una
  # sola vez en la vida de la instancia**, así que un reinicio no lo vuelve a
  # correr. El resultado es una instancia que Terraform da por actualizada y que
  # por dentro sigue con el script de arranque anterior — la peor forma de
  # divergencia, porque el estado dice que todo está al día.
  #
  # Reemplazarla es barato aquí: no hay nada en su disco. La base está en RDS,
  # la caché en ElastiCache, la evidencia en S3 y la aplicación se baja de ECR
  # al arrancar. La IP tampoco cambia: el EIP se reasocia sola.
  user_data_replace_on_change = true

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
  }

  metadata_options {
    http_tokens = "required" # IMDSv2 obligatorio
  }

  tags = { Name = "${local.nombre}-backend" }
}

resource "aws_eip" "backend" {
  count = var.habilitar_escalado ? 0 : 1

  instance = aws_instance.backend[0].id
  domain   = "vpc"

  tags = { Name = "${local.nombre}-backend" }
}
