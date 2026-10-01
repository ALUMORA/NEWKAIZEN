#!/bin/bash
# Uso: heavy.sh <comando> [args...]
# Corre el comando ocupando uno de HEAVY_SLOTS cupos (3 por omisión) compartidos por todos los
# agentes de la fase 5, para que no corran a la vez más de tres cosas pesadas (npm run check,
# pytest completo, e2e, Playwright, Lighthouse, vite build). Si en HEAVY_WAIT segundos (420 por
# omisión) no hay cupo, sale con 75 y avisa: vuelve a intentarlo después.
SLOTS=${HEAVY_SLOTS:-3}
WAIT=${HEAVY_WAIT:-420}
# HEAVY_POOL separa cupos por recurso: "heavy" (RAM, 3 cupos) y "yahoo" (grabaciones, HEAVY_SLOTS=1).
DIR=/private/tmp/claude-501/-Users-luisalfredolizarragasanchez-Desktop-CLAUDE/2cc037ba-fa15-4041-9ce5-e7079f6f5abf/scratchpad/heavy-locks/${HEAVY_POOL:-heavy}
mkdir -p "$DIR"
start=$(date +%s)
while :; do
  for i in $(seq 1 "$SLOTS"); do
    slot="$DIR/slot$i"
    if mkdir "$slot" 2>/dev/null; then
      echo $$ > "$slot/pid"
      echo "$*" > "$slot/cmd"
      release() { rm -f "$slot/pid" "$slot/cmd"; rmdir "$slot" 2>/dev/null; }
      trap release EXIT INT TERM
      "$@"
      rc=$?
      release
      trap - EXIT INT TERM
      exit $rc
    fi
    # Cupo huérfano: su dueño ya no existe.
    pid=$(cat "$slot/pid" 2>/dev/null)
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$slot/pid" "$slot/cmd"; rmdir "$slot" 2>/dev/null
    fi
  done
  if [ $(( $(date +%s) - start )) -ge "$WAIT" ]; then
    echo "heavy.sh: sin cupo después de ${WAIT}s (ocupados: $(cat "$DIR"/slot*/cmd 2>/dev/null | tr '\n' ';')). Vuelve a intentar." >&2
    exit 75
  fi
  sleep 5
done
