# --------------------------------------------------------------------------
# CloudFront delante de la API
#
# Resuelve dos cosas a la vez:
#
#   1. TLS. El Principio V exige que todo dato de inventario viaje cifrado, y
#      una PWA con Service Worker necesita contexto seguro. CloudFront da un
#      certificado válido en *.cloudfront.net sin tener que comprar dominio.
#   2. Puerto 443. Muchas redes corporativas —incluida la del equipo— filtran
#      puertos no estándar; el origen sigue en 3000, pero nadie lo ve.
#
# La caché va DESACTIVADA a propósito: esto es una API de inventario, y servir
# una respuesta cacheada sería servir un conteo viejo.
# --------------------------------------------------------------------------

data "aws_cloudfront_cache_policy" "sin_cache" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "todo_menos_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

resource "aws_cloudfront_distribution" "api" {
  count = var.habilitar_escalado ? 0 : 1

  enabled         = true
  comment         = "${local.nombre} API"
  http_version    = "http2and3"
  price_class     = "PriceClass_100" # Norteamérica y Europa: suficiente para Colombia
  is_ipv6_enabled = true

  origin {
    origin_id   = "api"
    domain_name = aws_eip.backend[0].public_dns

    custom_origin_config {
      http_port              = 3000
      https_port             = 443
      origin_protocol_policy = "http-only" # el tramo CloudFront→origen va dentro de AWS
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }
  }

  default_cache_behavior {
    target_origin_id       = "api"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods  = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.sin_cache.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.todo_menos_host.id

    compress = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  tags = { Name = "${local.nombre}-api" }
}
