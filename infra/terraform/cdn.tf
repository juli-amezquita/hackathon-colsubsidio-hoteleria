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
# La caché va DESACTIVADA en las rutas de la API a propósito: esto es un
# inventario, y servir una respuesta cacheada sería servir un conteo viejo. El
# PWA sí se cachea: son archivos con hash en el nombre.
#
# ⚠️ El PWA se sirve desde AQUÍ y no desde otro alojamiento porque la cookie de
# sesión es `SameSite=Strict`. Ver `pwa.tf`.
# --------------------------------------------------------------------------

# Las rutas de la API, en un solo sitio.
#
# Salen de los `@Controller` del backend, y una prueba verifica que esta lista
# no se quede atrás (`test/rutas-cdn.spec.ts`). Sin esa prueba, añadir un
# controlador y olvidarse de esta lista haría que la ruta nueva devolviera el
# `index.html` del PWA — un fallo raro de diagnosticar, porque responde 200.
locals {
  rutas_api = [
    "administracion",
    "aprendizaje",
    "auditoria",
    "bodegas",
    "consulta",
    "integracion",
    "rondas",
    "salud",
    "sesion",
    "tiempo",
    "voz",
  ]
}

data "aws_cloudfront_cache_policy" "sin_cache" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "todo_menos_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

data "aws_cloudfront_cache_policy" "optimizado" {
  name = "Managed-CachingOptimized"
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

  origin {
    origin_id                = "pwa"
    domain_name              = aws_s3_bucket.pwa.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.pwa.id
  }

  # Por defecto: el PWA. La API es la excepción enumerada, no al revés — su
  # superficie está en el código y se puede listar; la del PWA no.
  default_root_object = "index.html"

  default_cache_behavior {
    target_origin_id       = "pwa"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods = ["GET", "HEAD", "OPTIONS"]
    cached_methods  = ["GET", "HEAD"]

    cache_policy_id = data.aws_cloudfront_cache_policy.optimizado.id
    compress        = true
  }

  # Una ruta del cliente —`/ronda/abc`— no existe como objeto en S3. Sin esto,
  # recargar la página en cualquier pantalla que no sea la raíz daría 403.
  dynamic "custom_error_response" {
    for_each = [403, 404]

    content {
      error_code            = custom_error_response.value
      response_code         = 200
      response_page_path    = "/index.html"
      error_caching_min_ttl = 0
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = local.rutas_api

    content {
      path_pattern           = "/${ordered_cache_behavior.value}*"
      target_origin_id       = "api"
      viewer_protocol_policy = "redirect-to-https"

      allowed_methods = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods  = ["GET", "HEAD"]

      cache_policy_id          = data.aws_cloudfront_cache_policy.sin_cache.id
      origin_request_policy_id = data.aws_cloudfront_origin_request_policy.todo_menos_host.id

      compress = true
    }
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
