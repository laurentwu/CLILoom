#!/bin/sh
set -e

if type update-alternatives >/dev/null 2>&1; then
  if [ -L '/usr/bin/${executable}' ] && [ -e '/usr/bin/${executable}' ] && \
    [ "$(readlink '/usr/bin/${executable}')" != '/etc/alternatives/${executable}' ]; then
    rm -f '/usr/bin/${executable}'
  fi
  update-alternatives --install \
    '/usr/bin/${executable}' \
    '${executable}' \
    '/opt/${sanitizedProductName}/${executable}' \
    100
else
  ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

sandbox_helper='/opt/${sanitizedProductName}/chrome-sandbox'
chown root:root "$sandbox_helper"
chmod 4755 "$sandbox_helper"

if hash update-mime-database 2>/dev/null; then
  update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
  update-desktop-database /usr/share/applications || true
fi
