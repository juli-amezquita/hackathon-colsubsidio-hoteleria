# --------------------------------------------------------------------------
# Escalado — DISEÑADO, no construido para el demo (D-25)
#
# Todo este archivo está detrás de `habilitar_escalado`, en falso por defecto.
# Se puede encender sin refactorizar nada porque la API es stateless:
#   · sesión en cookie firmada, sin estado en el servidor (D-20)
#   · caché compartida en Redis, no en memoria del proceso (D-18)
#   · el audio va del navegador directo a Deepgram (D-07-A)
#
# Consecuencia: no hay sticky sessions, no hay idle_timeout de una hora, y un
# despliegue es un reemplazo en vez de un draining.
# --------------------------------------------------------------------------

resource "aws_lb" "principal" {
  count = var.habilitar_escalado ? 1 : 0

  name               = "${local.nombre}-alb"
  load_balancer_type = "application"
  subnets            = aws_subnet.publica[*].id
  security_groups    = [aws_security_group.alb[0].id]

  enable_deletion_protection = var.entorno == "produccion"
  idle_timeout               = 60 # peticiones HTTP cortas: el audio no pasa por aquí

  tags = { Name = "${local.nombre}-alb" }
}

resource "aws_lb_target_group" "api" {
  count = var.habilitar_escalado ? 1 : 0

  name     = "${local.nombre}-api"
  port     = 3000
  protocol = "HTTP"
  vpc_id   = aws_vpc.principal.id

  health_check {
    path                = "/salud"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }

  # 30 s basta: no hay sesiones largas que drenar.
  deregistration_delay = 30

  # Sin stickiness A PROPÓSITO. Si algún día hiciera falta, es señal de que se
  # metió estado en el proceso y hay que sacarlo, no de que falte configuración.
  stickiness {
    type    = "lb_cookie"
    enabled = false
  }
}

resource "aws_launch_template" "backend" {
  count = var.habilitar_escalado ? 1 : 0

  name_prefix   = "${local.nombre}-"
  image_id      = data.aws_ami.al2023_arm.id
  instance_type = var.tipo_instancia
  user_data     = base64encode(local.user_data)

  iam_instance_profile {
    name = aws_iam_instance_profile.backend.name
  }

  vpc_security_group_ids = [aws_security_group.backend.id]

  block_device_mappings {
    device_name = "/dev/xvda"

    ebs {
      volume_size = 20
      volume_type = "gp3"
      encrypted   = true
    }
  }

  metadata_options {
    http_tokens = "required"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_autoscaling_group" "backend" {
  count = var.habilitar_escalado ? 1 : 0

  name                = "${local.nombre}-backend"
  vpc_zone_identifier = aws_subnet.publica[*].id
  target_group_arns   = [aws_lb_target_group.api[0].arn]

  min_size         = var.capacidad_minima
  max_size         = var.capacidad_maxima
  desired_capacity = var.capacidad_minima

  health_check_type = "ELB"

  # Calentamiento, no enfriamiento: el seguimiento de objetivo no cuenta una
  # instancia hasta que está lista, en vez de esperar a ciegas entre ajustes.
  default_instance_warmup = 90

  launch_template {
    id      = aws_launch_template.backend[0].id
    version = "$Latest"
  }

  instance_refresh {
    strategy = "Rolling"

    preferences {
      min_healthy_percentage = 50
    }
  }

  tag {
    key                 = "Name"
    value               = "${local.nombre}-backend"
    propagate_at_launch = true
  }
}

# --------------------------------------------------------------------------
# Métrica de escalado: operarios simultáneos por instancia
#
# NO se usa ALBRequestCountPerTarget. La carga de este sistema no está en el
# número de peticiones —cada operario escribe una vez cada ~15 s— sino en
# cuántas personas están contando a la vez. Escalar por peticiones mediría lo
# que no duele.
#
# La API publica `SesionesActivas` con dimensión AutoScalingGroupName.
# --------------------------------------------------------------------------
resource "aws_autoscaling_policy" "por_sesiones" {
  count = var.habilitar_escalado ? 1 : 0

  name                   = "${local.nombre}-sesiones-por-instancia"
  autoscaling_group_name = aws_autoscaling_group.backend[0].name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    target_value = var.sesiones_por_instancia

    customized_metric_specification {
      metrics {
        id    = "sesiones"
        label = "Sesiones activas totales"

        metric_stat {
          metric {
            namespace   = "CapturaInventarios"
            metric_name = "SesionesActivas"

            dimensions {
              name  = "AutoScalingGroupName"
              value = aws_autoscaling_group.backend[0].name
            }
          }
          stat = "Sum"
        }

        return_data = false
      }

      metrics {
        id    = "instancias"
        label = "Instancias en servicio"

        metric_stat {
          metric {
            namespace   = "AWS/AutoScaling"
            metric_name = "GroupInServiceInstances"

            dimensions {
              name  = "AutoScalingGroupName"
              value = aws_autoscaling_group.backend[0].name
            }
          }
          stat = "Average"
        }

        return_data = false
      }

      metrics {
        id          = "por_instancia"
        label       = "Sesiones por instancia"
        expression  = "sesiones / instancias"
        return_data = true
      }
    }
  }
}

# --------------------------------------------------------------------------
# Pre-calentamiento programado
#
# El pico es PREDECIBLE: el inventario es mensual y se agenda. Escalar de forma
# puramente reactiva llega tarde — nadie arranca diez instancias en los minutos
# en que entran 350 operarios a la vez.
#
# Las expresiones cron van en UTC. 11:00 UTC = 06:00 en Colombia.
# --------------------------------------------------------------------------
resource "aws_autoscaling_schedule" "precalentar" {
  count = var.habilitar_escalado ? 1 : 0

  scheduled_action_name  = "${local.nombre}-precalentar"
  autoscaling_group_name = aws_autoscaling_group.backend[0].name

  recurrence = "0 11 1-5 * *" # primeros cinco días del mes, 06:00 Colombia
  time_zone  = "America/Bogota"

  min_size         = 6
  max_size         = var.capacidad_maxima
  desired_capacity = 10
}

resource "aws_autoscaling_schedule" "enfriar" {
  count = var.habilitar_escalado ? 1 : 0

  scheduled_action_name  = "${local.nombre}-enfriar"
  autoscaling_group_name = aws_autoscaling_group.backend[0].name

  recurrence = "0 23 1-5 * *" # 18:00 Colombia
  time_zone  = "America/Bogota"

  min_size         = var.capacidad_minima
  max_size         = var.capacidad_maxima
  desired_capacity = var.capacidad_minima
}
