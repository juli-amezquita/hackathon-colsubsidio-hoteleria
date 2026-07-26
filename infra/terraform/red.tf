data "aws_availability_zones" "disponibles" {
  state = "available"
}

locals {
  nombre = "${var.nombre}-${var.entorno}"
  azs    = slice(data.aws_availability_zones.disponibles.names, 0, 2)
}

resource "aws_vpc" "principal" {
  cidr_block           = var.cidr_vpc
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = local.nombre }
}

resource "aws_internet_gateway" "principal" {
  vpc_id = aws_vpc.principal.id
  tags   = { Name = local.nombre }
}

# Públicas: el backend y, si se habilita, el ALB.
resource "aws_subnet" "publica" {
  count = 2

  vpc_id                  = aws_vpc.principal.id
  cidr_block              = cidrsubnet(var.cidr_vpc, 8, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = { Name = "${local.nombre}-publica-${count.index + 1}" }
}

# Privadas: RDS y Redis. Sin NAT Gateway a propósito — ninguna de las dos
# necesita salida a internet, y un NAT cuesta más que la instancia del backend.
resource "aws_subnet" "privada" {
  count = 2

  vpc_id            = aws_vpc.principal.id
  cidr_block        = cidrsubnet(var.cidr_vpc, 8, count.index + 10)
  availability_zone = local.azs[count.index]

  tags = { Name = "${local.nombre}-privada-${count.index + 1}" }
}

resource "aws_route_table" "publica" {
  vpc_id = aws_vpc.principal.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.principal.id
  }

  tags = { Name = "${local.nombre}-publica" }
}

resource "aws_route_table_association" "publica" {
  count = 2

  subnet_id      = aws_subnet.publica[count.index].id
  route_table_id = aws_route_table.publica.id
}

# --------------------------------------------------------------------------
# Grupos de seguridad
# --------------------------------------------------------------------------

resource "aws_security_group" "backend" {
  name        = "${local.nombre}-backend"
  description = "API NestJS y worker de outbox"
  vpc_id      = aws_vpc.principal.id

  tags = { Name = "${local.nombre}-backend" }
}

# Sin ALB (MVP): CloudFront termina TLS y este es su origen.
#
# La puerta es nginx en el 80, y solo la abre CloudFront. AWS publica la lista
# de rangos que usan sus servidores de borde para hablar con orígenes y la
# mantiene al día sola: usarla es más seguro que `0.0.0.0/0` y no cuesta
# mantenimiento. El 3000 y el 3001 ya no se exponen — viven dentro de la red de
# Docker, donde solo los alcanza nginx.
data "aws_ec2_managed_prefix_list" "cloudfront_origen" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_vpc_security_group_ingress_rule" "backend_http" {
  count = var.habilitar_escalado ? 0 : 1

  security_group_id = aws_security_group.backend.id
  description       = "nginx (solo desde los bordes de CloudFront)"
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront_origen.id
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

# Con ALB: solo el balanceador puede hablarle a la instancia.
resource "aws_vpc_security_group_ingress_rule" "backend_desde_alb" {
  count = var.habilitar_escalado ? 1 : 0

  security_group_id            = aws_security_group.backend.id
  description                  = "Solo el ALB alcanza la API"
  referenced_security_group_id = aws_security_group.alb[0].id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
}

# SSH solo si se declaran IPs administrativas. Lo normal es NO abrirlo y usar
# SSM Session Manager: no depende de que el ISP no rote la IP de quien administra.
resource "aws_vpc_security_group_ingress_rule" "backend_ssh" {
  count = length(var.ips_admin)

  security_group_id = aws_security_group.backend.id
  description       = "SSH administrativo"
  cidr_ipv4         = var.ips_admin[count.index]
  from_port         = 22
  to_port           = 22
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "backend_salida" {
  security_group_id = aws_security_group.backend.id
  description       = "Salida a Deepgram, OpenRouter, ERP y actualizaciones"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "datos" {
  name        = "${local.nombre}-datos"
  description = "PostgreSQL y Redis. Solo alcanzables desde el backend."
  vpc_id      = aws_vpc.principal.id

  tags = { Name = "${local.nombre}-datos" }
}

resource "aws_vpc_security_group_ingress_rule" "postgres" {
  security_group_id            = aws_security_group.datos.id
  description                  = "PostgreSQL desde el backend"
  referenced_security_group_id = aws_security_group.backend.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "redis" {
  security_group_id            = aws_security_group.datos.id
  description                  = "Redis desde el backend"
  referenced_security_group_id = aws_security_group.backend.id
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
}

# Sin regla de salida: ni la base ni la caché inician conexiones.

resource "aws_security_group" "alb" {
  count = var.habilitar_escalado ? 1 : 0

  name        = "${local.nombre}-alb"
  description = "Balanceador publico"
  vpc_id      = aws_vpc.principal.id

  tags = { Name = "${local.nombre}-alb" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  count = var.habilitar_escalado ? 1 : 0

  security_group_id = aws_security_group.alb[0].id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "alb_salida" {
  count = var.habilitar_escalado ? 1 : 0

  security_group_id            = aws_security_group.alb[0].id
  referenced_security_group_id = aws_security_group.backend.id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
}
