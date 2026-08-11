#!/bin/sh
set -e

if [ -z "${APPDIR:-}" ]; then
  APPDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
fi

export PATH="${APPDIR}:${APPDIR}/usr/sbin${PATH:+:${PATH}}"
export XDG_DATA_DIRS="${APPDIR}/usr/share/${XDG_DATA_DIRS:+:${XDG_DATA_DIRS}}:/usr/share/gnome:/usr/local/share:/usr/share"
export LD_LIBRARY_PATH="${APPDIR}/usr/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
export GSETTINGS_SCHEMA_DIR="${APPDIR}/usr/share/glib-2.0/schemas${GSETTINGS_SCHEMA_DIR:+:${GSETTINGS_SCHEMA_DIR}}"

# A SUID helper cannot elevate from an AppImage mount. Select Chromium's primary
# user-namespace sandbox explicitly and fail closed when the host blocks it.
exec "${APPDIR}/cliloom" --disable-setuid-sandbox "$@"
