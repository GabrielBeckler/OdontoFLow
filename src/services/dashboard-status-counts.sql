SELECT
  COALESCE(
    (
      SELECT h.para_status
      FROM historico_status_os h
      WHERE h.ordem_servico_id = o.id
        AND h.alterado_em < $1
      ORDER BY h.alterado_em DESC, h.id DESC
      LIMIT 1
    ),
    o.status
  ) AS name,
  COUNT(*) AS value
FROM ordens_servico o
WHERE o.arquivada_em IS NULL
  AND o.criada_em < $1
GROUP BY name
ORDER BY name;
