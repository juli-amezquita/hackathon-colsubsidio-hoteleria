variable "region" {
  description = "Región de AWS."
  type        = string
  default     = "us-east-1"
}

variable "entorno" {
  description = "Nombre del entorno (mvp | produccion)."
  type        = string
  default     = "mvp"

  validation {
    condition     = contains(["mvp", "produccion"], var.entorno)
    error_message = "El entorno debe ser 'mvp' o 'produccion'."
  }
}

variable "nombre" {
  description = "Prefijo de nombre para todos los recursos."
  type        = string
  default     = "cci"
}

variable "cidr_vpc" {
  description = "Rango de la VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "ips_admin" {
  description = <<-DESC
    IPs con acceso administrativo (SSH). En /32.
    Dejar vacío usa exclusivamente SSM Session Manager, que es lo recomendado:
    no abre el puerto 22 y sobrevive a que el ISP rote la IP de quien administra.
  DESC
  type        = list(string)
  default     = []
}

variable "tipo_instancia" {
  description = <<-DESC
    Tipo de instancia del backend. t4g = Graviton (ARM): las imágenes Docker
    deben construirse para linux/arm64. Es ~20% más barato a igual rendimiento.
  DESC
  type        = string
  default     = "t4g.small"
}

variable "clase_rds" {
  description = "Clase de la instancia RDS PostgreSQL 17."
  type        = string
  default     = "db.t4g.micro"
}

variable "nodo_redis" {
  description = "Tipo de nodo de ElastiCache Redis."
  type        = string
  default     = "cache.t4g.micro"
}

variable "habilitar_escalado" {
  description = <<-DESC
    Crea ALB + Auto Scaling Group. FALSO en el MVP a propósito (D-25):
    el escalado está DISEÑADO, no construido, para el demo.

    Ponerlo en verdadero es seguro porque la API es stateless (D-07-A, D-18, D-20):
    no hay sticky sessions, ni idle_timeout largo, ni draining que gestionar.
  DESC
  type        = bool
  default     = false
}

variable "capacidad_minima" {
  description = "Instancias mínimas del ASG."
  type        = number
  default     = 2
}

variable "capacidad_maxima" {
  description = "Instancias máximas del ASG."
  type        = number
  default     = 12
}

variable "sesiones_por_instancia" {
  description = <<-DESC
    Objetivo de operarios simultáneos por instancia (seguimiento de objetivo).
    Es 0,7 × la capacidad medida, para dejar margen antes de saturar.
    Con ~350 bodegas y este objetivo, el pico pide ~10 instancias.

    NO se usa ALBRequestCountPerTarget: la carga de este sistema no está en el
    número de peticiones sino en cuántos operarios hay contando a la vez.
  DESC
  type        = number
  default     = 35
}

variable "retencion_audio_dias" {
  description = <<-DESC
    Días que se conserva el audio de evidencia en S3 antes de expirar.
    Solo se sube el audio de turnos en disputa (~10%); el resto se descarta en
    el dispositivo. Minimización de datos, Ley 1581 y Principio V.
  DESC
  type        = number
  default     = 180
}
