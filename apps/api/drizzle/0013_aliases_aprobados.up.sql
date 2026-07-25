-- 0013 · El alias deja de ser dato suelto y pasa a ser una decisión.
--
-- Hasta aquí `articulo_alias` era una tabla de referencia que alguien poblaba a
-- mano. Con el reporte de aprendizaje pasa a llenarse APROBANDO propuestas que
-- el propio sistema levanta de su operación, y eso cambia lo que hay que saber
-- de cada fila: quién la aprobó y cuándo.
--
-- Un alias no mueve ningún umbral ni cambia ningún veredicto pasado — enseña
-- que cierta forma de decir las cosas apunta a cierto artículo — pero decide a
-- qué artículo se imputa un conteo. Eso tiene consecuencia, y lo que tiene
-- consecuencia lleva nombre y fecha.

ALTER TABLE articulo_alias
  ADD COLUMN creado_por uuid REFERENCES usuario(id),
  ADD COLUMN creado_en  timestamptz NOT NULL DEFAULT now();

-- Un alias apunta a UN artículo dentro de una bodega.
--
-- La unicidad anterior era `(bodega, alias, artículo)`, que permite que "aceite"
-- apunte a dos artículos a la vez — y un alias ambiguo no resuelve nada: deja
-- al operario exactamente donde estaba, eligiendo de una lista.
CREATE UNIQUE INDEX alias_unico_por_bodega
  ON articulo_alias (bodega_id, alias_normalizado);
