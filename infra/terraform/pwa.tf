# --------------------------------------------------------------------------
# El PWA del operario, servido desde el MISMO origen que la API
#
# No es una preferencia de despliegue: es una condición.
#
# La cookie de sesión es `SameSite=Strict` (F-14). Un navegador NO la envía en
# peticiones a otro sitio, así que un frontend alojado aparte —Vercel, Amplify,
# otro dominio— recibiría 401 en todo. Las alternativas serían bajar la cookie a
# `SameSite=None` y añadir token CSRF, o abrir CORS con credenciales: las dos
# cambian una propiedad de seguridad para resolver un problema de despliegue.
#
# Servirlo desde la misma distribución lo elimina de raíz: mismo origen, la
# cookie viaja sola, CORS no interviene y el Service Worker tiene su contexto
# seguro sin comprar dominio.
# --------------------------------------------------------------------------

resource "aws_s3_bucket" "pwa" {
  bucket = "${local.nombre}-pwa-${random_id.sufijo.hex}"
  tags   = { Name = "${local.nombre}-pwa" }
}

# El bucket NO es público. CloudFront entra por Origin Access Control y nadie
# más; un bucket público sería una segunda puerta al mismo contenido, con sus
# propias reglas y sin el TLS ni las cabeceras de la distribución.
resource "aws_s3_bucket_public_access_block" "pwa" {
  bucket = aws_s3_bucket.pwa.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "pwa" {
  bucket = aws_s3_bucket.pwa.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "pwa" {
  name                              = "${local.nombre}-pwa"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Solo esta distribución puede leer el bucket. La condición sobre el ARN de la
# distribución es lo que impide que otra cuenta con OAC apunte aquí.
data "aws_iam_policy_document" "pwa" {
  count = var.habilitar_escalado ? 0 : 1

  statement {
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.pwa.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.api[0].arn]
    }
  }
}

resource "aws_s3_bucket_policy" "pwa" {
  count = var.habilitar_escalado ? 0 : 1

  bucket = aws_s3_bucket.pwa.id
  policy = data.aws_iam_policy_document.pwa[0].json
}

output "bucket_pwa" {
  description = "Bucket del PWA. Se publica con: aws s3 sync ./dist s3://<bucket> --delete"
  value       = aws_s3_bucket.pwa.id
}
