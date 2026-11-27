#!/usr/bin/env bash
# Move the ERP backend (one PM2 app + its PostgreSQL database + uploaded files)
# from one EC2 server to another. Run from Git Bash. Read README.md first.
set -Eeuo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CONFIG="${CONFIG:-$HERE/config.sh}"

say()  { printf '\n==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die()  { printf 'STOP: %s\n' "$*" >&2; exit 1; }

[ -f "$CONFIG" ] || die "Missing $CONFIG. Copy config.example.sh to config.sh and fill it in."
# shellcheck source=/dev/null
source "$CONFIG"

for v in SRC_HOST DST_HOST SSH_USER APP OLD_DOMAIN NEW_DOMAIN; do
  [[ ${!v} =~ ^[A-Za-z0-9_.-]+$ ]] || die "Bad value for $v in config.sh"
done
[[ $APP_DIR =~ ^/[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+$ && $APP_DIR != "/home/$SSH_USER" && $APP_DIR != */ ]] ||
  die "APP_DIR must be the app's own folder, like /app/my-app"
[[ $PORT =~ ^[0-9]+$ && $SWAP_MB =~ ^[0-9]+$ ]] || die "PORT and SWAP_MB must be numbers"
[[ $PUBLIC_PREFIX =~ ^/[A-Za-z0-9_-]+$ ]] || die "PUBLIC_PREFIX must look like /sawant-erp"
[ "$SRC_HOST" != "$DST_HOST" ] || die "SRC_HOST and DST_HOST are the same server"
[ "$OLD_DOMAIN" != "$NEW_DOMAIN" ] || die "NEW_DOMAIN must differ from OLD_DOMAIN"

SSH_BIN=ssh
[ -x /usr/bin/ssh ] && SSH_BIN=/usr/bin/ssh

confirm() { # message word
  local answer
  printf '\n%s\nType %s to continue: ' "$1" "$2"
  read -r answer
  [ "$answer" = "$2" ] || die "Cancelled. Nothing was done by this step."
}

on() { # src|dst command...
  local role=$1 key host
  shift
  if [ "$role" = src ]; then key=$SRC_KEY host=$SRC_HOST; else key=$DST_KEY host=$DST_HOST; fi
  [ -f "$key" ] || die "SSH key not found: $key"
  "$SSH_BIN" -i "$key" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
    -o ServerAliveInterval=30 "$SSH_USER@$host" "$@"
}

# Shell functions every remote script starts with.
read -r -d '' PRELUDE <<'EOF' || true
set -e -o pipefail
export PATH="$PATH:/usr/local/bin:/usr/sbin:/sbin"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true; fi
cd /tmp
M="$HOME/ec2-migration"
pm2_json() { pm2 jlist 2>/dev/null || true; }
pm2_names() {
  pm2_json | node -e '
    const s = require("fs").readFileSync(0, "utf8"); const i = s.indexOf("[{");
    console.log((i < 0 ? [] : JSON.parse(s.slice(i))).map((x) => x.name).join(" "));
  '
}
# prints: status <tab> folder <tab> node-version <tab> restarts
app_info() {
  pm2_json | node -e '
    const s = require("fs").readFileSync(0, "utf8"); const i = s.indexOf("[{");
    const p = (i < 0 ? [] : JSON.parse(s.slice(i))).find((x) => x.name === process.argv[1]);
    if (p) { const e = p.pm2_env; console.log([e.status, e.pm_cwd, e.node_version || "?", e.restart_time].join("\t")); }
  ' "$1"
}
# writes a PM2 start file for one app (contains its environment: keep it private)
ecosystem_json() { # app
  pm2_json | node -e '
    const s = require("fs").readFileSync(0, "utf8"); const i = s.indexOf("[{");
    const all = (i < 0 ? [] : JSON.parse(s.slice(i))).filter((x) => x.name === process.argv[1]);
    if (!all.length) { console.error("PM2 app not found"); process.exit(1); }
    const e = all[0].pm2_env;
    const skip = /^(HOME|PATH|PWD|OLDPWD|SHELL|USER|LOGNAME|SHLVL|TERM|LANG|LC_.*|MAIL|_|SSH_.*|XDG_.*|LS_COLORS|HIST.*|HOSTNAME|PM2_.*|SUDO_.*|NVM_.*|DBUS_.*|NODE_APP_INSTANCE|unique_id|which_declare|LESSOPEN|S_COLORS|SYSTEMD_.*|MOTD_.*|BASH_FUNC.*)$/;
    const env = {};
    for (const [k, v] of Object.entries(e.env || {}))
      if (!skip.test(k) && k !== e.name && typeof v !== "object") env[k] = v;
    const app = { name: e.name, cwd: e.pm_cwd, script: e.pm_exec_path, args: e.args, node_args: e.node_args,
      exec_mode: e.exec_mode === "cluster_mode" ? "cluster" : "fork", instances: all.length,
      interpreter: e.exec_interpreter,
      max_memory_restart: e.max_memory_restart, nodeVersion: e.node_version, env, time: true };
    process.stdout.write(JSON.stringify({ apps: [app] }, null, 2));
  ' "$1"
}
write_ecosystem() { # app file
  mkdir -p "$(dirname "$2")"
  ( umask 077; ecosystem_json "$1" > "$2" )
}
EOF

# run src|dst [args...] <<'EOF' remote script EOF
run() {
  local role=$1 args=""
  shift
  [ $# -eq 0 ] || args=$(printf ' %q' "$@")
  { printf '%s\n{\n' "$PRELUDE"; cat; printf '\nexit 0\n} </dev/null\n'; } | on "$role" "bash -s --$args"
}

# ---------------------------------------------------------------- database facts

DB_HOST="" DB_PORT="" DB_NAME="" DB_USER="" DB_WHERE=""
load_db() {
  local out
  out=$(run src "$APP" "$APP_DIR" <<'EOF'
info=$(pm2_json | node -e '
  const fs = require("fs"); const s = fs.readFileSync(0, "utf8"); const i = s.indexOf("[{");
  const p = (i < 0 ? [] : JSON.parse(s.slice(i))).find((x) => x.name === process.argv[1]);
  let v = p && p.pm2_env.env && p.pm2_env.env.DATABASE_URL;
  if (!v) {
    const m = fs.readFileSync(process.argv[2] + "/.env", "utf8").match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)$/m);
    if (!m) { console.error("No DATABASE_URL found"); process.exit(2); }
    v = m[1].trim(); const q = v.match(/^(["\x27])(.*?)\1/); v = q ? q[2] : v.split(/\s+#/)[0];
  }
  try { const u = new URL(v);
    console.log([u.hostname, u.port || 5432, decodeURIComponent(u.pathname.slice(1)), decodeURIComponent(u.username)].join(" "));
  } catch { console.error("DATABASE_URL could not be read"); process.exit(2); }
' "$1" "$2")
read -r host port name user <<<"$info"
where=external
case " localhost 127.0.0.1 [::1] " in *" $host "*) where=local ;; esac
case " $(hostname -I) " in *" $host "*) where=private-ip ;; esac
echo "$host $port $name $user $where"
EOF
  ) || die "Could not read the database settings on server 1"
  read -r DB_HOST DB_PORT DB_NAME DB_USER DB_WHERE <<<"$out"
  [[ $DB_NAME =~ ^[A-Za-z0-9_.-]+$ && $DB_USER =~ ^[A-Za-z0-9_.-]+$ ]] || die "Unexpected database or user name"
  case $DB_NAME in postgres | template0 | template1) die "The app uses the system database '$DB_NAME'; move it by hand" ;; esac
}

guard_not_live() {
  local state
  state=$(run dst <<'EOF'
if [ -f "$M/LIVE" ]; then echo live; fi
EOF
  )
  [ "$state" != live ] || die "Server 3 is already live. Copying again would overwrite its newer data."
}

# ---------------------------------------------------------------- check (read only)

cmd_check() {
  local src dst fail=0
  say "Server 1 ($SRC_HOST): reading only"
  load_db
  src=$(run src "$APP" "$APP_DIR" "$PORT" "$DB_NAME" "$DB_WHERE" "$OLD_DOMAIN" "$SRC_HOST" <<'EOF'
app=$1 dir=$2 port=$3 db=$4 where=$5 old=$6 ip=$7
. /etc/os-release
echo "os: $PRETTY_NAME $(uname -m), $(openssl version)"
info=$(app_info "$app")
if [ -z "$info" ]; then echo "FAIL: no PM2 app called $app"; exit 0; fi
IFS=$'\t' read -r status cwd nodev restarts <<<"$info"
echo "app: $status, node $nodev, restarts $restarts, folder $cwd"
[ "$cwd" = "$dir" ] || echo "FAIL: PM2 runs the app from $cwd, but APP_DIR is $dir"
echo "size: app $(sudo du -sh "$dir" | cut -f1), uploads $(sudo du -sh "$dir/storage" 2>/dev/null | cut -f1 || echo none)"
echo "storage driver: $(sudo grep -E '^STORAGE_DRIVER=' "$dir/.env" 2>/dev/null | cut -d= -f2 || echo 'local (default)')"
echo "ARCH=$(uname -m)"
echo "SSL=$(openssl version | awk '{print $2}' | cut -d. -f1)"
need=$(sudo du -sk "$dir" | cut -f1)
if [ "$where" != external ]; then
  echo "database: PostgreSQL $(sudo -u postgres psql -Atc 'show server_version'), $db = $(sudo -u postgres psql -Atc "select pg_size_pretty(pg_database_size('$db'))")"
  need=$((need + 2 * $(sudo -u postgres psql -Atc "select pg_database_size('$db') / 1024")))
fi
echo "NEEDKB=$need"
role=$(curl -fsS -m 2 -H "X-aws-ec2-metadata-token: $(curl -fsS -m 2 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' || true)" http://169.254.169.254/latest/meta-data/iam/security-credentials/ 2>/dev/null || echo none)
echo "AWS role: $role"
echo "-- Nginx lines that send traffic to port $port (compare with the server 3 config in README):"
sudo nginx -T 2>/dev/null | grep -nE -B8 -A10 "proxy_pass +https?://[^;]*:$port" || echo "  none found"
echo "-- cron lines that mention the app (switch these off at cutover):"
{ crontab -l 2>/dev/null; sudo crontab -l 2>/dev/null; sudo cat /etc/cron.d/* 2>/dev/null; } |
  grep -v '^[[:space:]]*#' | grep -E "$app|$dir" |
  sed -E 's#(://[^:/ ]+):[^@ ]+@#\1:<redacted>@#g; s#((password|token|secret|key)=)[^ &"]+#\1<redacted>#Ig' || echo "  none"
for name in "$old" "$ip"; do
  keys=$(sudo grep -F "$name" "$dir/.env" 2>/dev/null | grep -oE '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=' | tr -d '= \t' | paste -sd, - || true)
  [ -z "$keys" ] || echo "WARN: .env keys still pointing at $name: $keys"
done
sudo find "$dir/node_modules" -maxdepth 2 -type l 2>/dev/null | while read -r link; do
  target=$(readlink -f "$link" || true)
  case "$target" in "$dir"/*) ;; *) echo "note: $link points outside the app folder ($target)" ;; esac
done || true
EOF
  ) || die "Check on server 1 failed"
  grep -vE '^(ARCH|SSL|NEEDKB)=' <<<"$src"
  grep -q '^FAIL' <<<"$src" && die "Fix the problems above first"
  echo "database address used by the app: $DB_HOST:$DB_PORT ($DB_WHERE), user $DB_USER"
  case $DB_WHERE in
    external) warn "The database is on another machine. It will NOT be copied; allow $DST_HOST in its firewall." ;;
    private-ip) echo "FAIL: DATABASE_URL uses server 1's private IP. Change it to localhost on server 1, restart, check again."; fail=1 ;;
  esac

  local arch ssl need
  arch=$(sed -n 's/^ARCH=//p' <<<"$src")
  ssl=$(sed -n 's/^SSL=//p' <<<"$src")
  need=$(sed -n 's/^NEEDKB=//p' <<<"$src")

  say "Server 3 ($DST_HOST): reading only"
  dst=$(run dst "$APP" "$APP_DIR" "$PORT" "$DB_NAME" "$DB_WHERE" "$NEW_DOMAIN" "$DST_HOST" "$arch" "$ssl" "$need" "$SWAP_MB" <<'EOF'
app=$1 dir=$2 port=$3 db=$4 where=$5 domain=$6 ip=$7 arch=$8 ssl=$9 need=${10} swapmb=${11}
. /etc/os-release
echo "os: $PRETTY_NAME $(uname -m), $(openssl version)"
free -h
df -h /
[ "$(uname -m)" = "$arch" ] || echo "FAIL: processor type differs from server 1 ($arch)"
[ "$(openssl version | awk '{print $2}' | cut -d. -f1)" = "$ssl" ] || echo "note: OpenSSL differs; the Prisma client will be rebuilt after copying"
for c in node pm2 nginx psql; do command -v $c >/dev/null || sudo sh -c "command -v $c" >/dev/null || echo "note: $c is not installed"; done
echo "PM2 apps already here: $(pm2_names || true)"
echo "listening ports: $(sudo ss -ltnH | awk '{print $4}' | sed 's/.*://' | sort -un | paste -sd' ' -)"
managed=no; [ -f "$dir/.ec2-migration" ] && managed=yes
if [ "$managed" = no ]; then
  [ -z "$(app_info "$app")" ] || echo "FAIL: a PM2 app called $app already exists here"
  if [ -d "$dir" ] && [ -n "$(sudo ls -A "$dir")" ]; then echo "FAIL: $dir already has files in it"; fi
  if [ -n "$(sudo ss -ltnH "sport = :$port")" ]; then echo "FAIL: port $port is already in use"; fi
fi
if [ "$where" != external ] && sudo -u postgres psql -Atc 'select 1' >/dev/null 2>&1; then
  echo "PostgreSQL here: $(sudo -u postgres psql -Atc 'show server_version')"
  exists=$(sudo -u postgres psql -Atc "select 1 from pg_database where datname='$db'")
  if [ -n "$exists" ] && [ "$(cat "$M/db-name" 2>/dev/null || true)" != "$db" ]; then echo "FAIL: database $db already exists here"; fi
fi
free_kb=$(df -Pk / | awk 'NR==2 {print $4}')
extra=1048576; [ -n "$(swapon --show --noheadings)" ] || extra=$((extra + swapmb * 1024))
[ "$managed" = yes ] && need=0
[ "$free_kb" -gt $((need + extra)) ] || echo "FAIL: not enough disk. Free $((free_kb / 1024)) MB, wanted $(((need + extra) / 1024)) MB. Enlarge the EBS volume."
role=$(curl -fsS -m 2 -H "X-aws-ec2-metadata-token: $(curl -fsS -m 2 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' || true)" http://169.254.169.254/latest/meta-data/iam/security-credentials/ 2>/dev/null || echo none)
echo "AWS role: $role"
addr=$(getent ahostsv4 "$domain" | awk 'NR==1 {print $1}' || true)
echo "DNS: $domain -> ${addr:-not created yet}"
[ "$addr" = "$ip" ] || echo "FAIL: $domain does not point to $ip. NEW_DOMAIN must be an address server 3 already serves."
EOF
  ) || die "Check on server 3 failed"
  echo "$dst"
  grep -q '^FAIL' <<<"$dst" && fail=1
  [ "$fail" = 0 ] || die "Fix the FAIL lines above, then run check again"
  say "Check passed. Also compare the AWS role and storage driver lines (README, 'Before you start')."
}

# ---------------------------------------------------------------- prepare server 3

cmd_prepare() {
  local nodev pgmajor=""
  load_db
  nodev=$(run src "$APP" <<'EOF'
app_info "$1" | cut -f3
EOF
  )
  [[ $nodev =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Could not read the Node version of $APP"
  if [ "$DB_WHERE" != external ]; then
    pgmajor=$(run src <<'EOF'
echo $(($(sudo -u postgres psql -Atc 'show server_version_num') / 10000))
EOF
    )
  fi
  confirm "Prepare server 3 ($DST_HOST): swap file, Node $nodev${pgmajor:+, PostgreSQL $pgmajor}. Existing apps are not touched." PREPARE
  run dst "$nodev" "$pgmajor" "$SWAP_MB" <<'EOF'
nodev=$1 pgmajor=$2 swapmb=$3
mkdir -p "$M"; chmod 700 "$M"
[ "$(uname -m)" = x86_64 ] || { echo "STOP: expected an x86_64 server"; exit 1; }
command -v pm2 >/dev/null || { echo "STOP: PM2 is missing. Install Node and run: sudo npm install -g pm2"; exit 1; }

if [ "$swapmb" -gt 0 ] && [ -z "$(swapon --show --noheadings)" ]; then
  echo "-- creating ${swapmb} MB swap"
  sudo dd if=/dev/zero of=/swapfile bs=1M count="$swapmb" status=none
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# The app gets its own copy of Node, so other apps keep their current version.
if [ "$(node -p process.versions.node)" != "$nodev" ] && [ ! -x "/opt/node/v$nodev/bin/node" ]; then
  echo "-- installing Node $nodev into /opt/node"
  work=$(mktemp -d); cd "$work"
  file="node-v$nodev-linux-x64.tar.xz"
  curl -fsSLO "https://nodejs.org/dist/v$nodev/$file"
  curl -fsSLO "https://nodejs.org/dist/v$nodev/SHASUMS256.txt"
  grep " $file\$" SHASUMS256.txt | sha256sum -c -
  sudo mkdir -p "/opt/node/v$nodev"
  sudo tar -xJf "$file" -C "/opt/node/v$nodev" --strip-components=1
  cd /tmp; rm -rf "$work"
fi

if [ -n "$pgmajor" ]; then
  if sudo -u postgres psql -Atc 'select 1' >/dev/null 2>&1; then
    here=$(($(sudo -u postgres psql -Atc 'show server_version_num') / 10000))
    [ "$here" -ge "$pgmajor" ] || { echo "STOP: PostgreSQL $here here is older than $pgmajor on server 1"; exit 1; }
  elif command -v psql >/dev/null && [ -s /var/lib/pgsql/data/PG_VERSION ]; then
    echo "STOP: PostgreSQL is installed but not running. Start it, then run prepare again."; exit 1
  else
    command -v dnf >/dev/null || { echo "STOP: install PostgreSQL $pgmajor by hand (this server has no dnf)"; exit 1; }
    echo "-- installing PostgreSQL $pgmajor"
    sudo dnf install -y "postgresql$pgmajor-server" "postgresql$pgmajor-contrib"
    sudo postgresql-setup --initdb
    # allow password logins from this machine only
    sudo sed -i.orig -E '/^host/ s/(ident|peer)[[:space:]]*$/md5/' /var/lib/pgsql/data/pg_hba.conf
    sudo systemctl enable --now postgresql
    touch "$M/installed-pg"
  fi
fi
systemctl is-enabled "pm2-$USER" >/dev/null 2>&1 || echo "WARNING: PM2 does not start on reboot. Run 'pm2 startup' on server 3 and follow its output."
echo "prepare finished"
EOF
}

# ---------------------------------------------------------------- copy database

pg_counts() { # src|dst
  run "$1" "$DB_NAME" <<'EOF'
sudo -u postgres psql -At -F' ' -d "$1" -c "
  SELECT format('%I.%I', n.nspname, c.relname),
         (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM ONLY %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  ORDER BY 1"
EOF
}

copy_db() { # strict(1|0)
  local strict=$1 roles role missing a b
  if [ "$DB_WHERE" = external ]; then say "External database: nothing to copy"; return 0; fi

  run dst "$DB_NAME" <<'EOF'
mkdir -p "$M"; chmod 700 "$M"
exists=$(sudo -u postgres psql -Atc "select 1 from pg_database where datname='$1'")
if [ -n "$exists" ] && [ "$(cat "$M/db-name" 2>/dev/null || true)" != "$1" ]; then
  echo "STOP: database $1 already exists on server 3 and this script did not create it"; exit 1
fi
EOF

  say "Database users"
  roles=$(run src "$DB_NAME" "$DB_USER" <<'EOF'
{ echo "$2"
  sudo -u postgres psql -At -d "$1" -c "
    SELECT r.rolname FROM pg_shdepend d JOIN pg_roles r ON r.oid = d.refobjid
    JOIN pg_database db ON db.datname = current_database()
    WHERE d.refclassid = 'pg_authid'::regclass
      AND (d.dbid = db.oid OR (d.classid = 'pg_database'::regclass AND d.objid = db.oid))
    UNION SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()"
} | grep -v '^pg_' | sort -u
EOF
  )
  for role in $roles; do
    [[ $role =~ ^[A-Za-z0-9_.-]+$ ]] || die "Unexpected database user name"
    missing=$(run dst "$role" <<'EOF'
if [ "$1" = postgres ]; then
  if [ -f "$M/installed-pg" ]; then echo yes; fi
elif [ -z "$(sudo -u postgres psql -Atc "select 1 from pg_roles where rolname='$1'")" ]; then echo yes
fi
EOF
    )
    if [ "$missing" != yes ]; then
      echo "  $role: already on server 3, left unchanged (if the app cannot log in, set the same password there)"
      continue
    fi
    # The password hash goes straight from one server to the other and is never shown.
    on src "cd /tmp && sudo -u postgres pg_dumpall --roles-only | grep -E '^(CREATE|ALTER) ROLE \"?${role//./\\.}\"?[ ;]'" </dev/null |
      on dst "cd /tmp && sudo -u postgres psql -q >/dev/null 2>&1" ||
      die "Could not copy database user $role"
    run dst "$role" <<'EOF'
[ -n "$(sudo -u postgres psql -Atc "select 1 from pg_roles where rolname='$1'")" ] || { echo "STOP: could not create user $1"; exit 1; }
EOF
    echo "  $role: copied"
  done

  say "Copying database $DB_NAME"
  on src "cd /tmp && sudo -u postgres pg_dump -Fc '$DB_NAME'" </dev/null | on dst "umask 077; cat > ec2-migration/db.dump"
  run dst "$DB_NAME" <<'EOF'
echo "$1" > "$M/db-name"
sudo -u postgres dropdb --if-exists --force "$1"   # only ever a database this script made
sudo -u postgres pg_restore --create --exit-on-error -d postgres < "$M/db.dump"
sudo -u postgres vacuumdb -q --analyze-only -d "$1"
rm -f "$M/db.dump"
EOF

  say "Comparing row counts"
  a=$(pg_counts src)
  b=$(pg_counts dst)
  if [ "$a" = "$b" ]; then
    echo "  match: $(wc -l <<<"$a") tables"
  else
    diff <(echo "$a") <(echo "$b") || true
    [ "$strict" = 0 ] || die "Row counts differ"
    warn "Counts differ. In a practice copy this is normal if people are using the app."
  fi
}

# ---------------------------------------------------------------- copy app files

copy_files() {
  say "Copying $APP_DIR (code, .env, uploaded files)"
  run dst "$APP_DIR" <<'EOF'
if [ -d "$1" ] && [ -n "$(sudo ls -A "$1")" ] && [ ! -f "$1/.ec2-migration" ]; then
  echo "STOP: $1 on server 3 has files this script did not put there"; exit 1
fi
sudo mkdir -p "$1"
sudo touch "$1/.ec2-migration"
EOF
  on src "sudo tar -C '$APP_DIR' --warning=no-file-changed --exclude=./logs --exclude=./.ec2-migration -czf - .; rc=\$?; [ \$rc -le 1 ]" </dev/null |
    on dst "sudo tar -C '$APP_DIR' -xzpf -"

  local src_ssl
  src_ssl=$(on src "openssl version | cut -d' ' -f2 | cut -d. -f1" </dev/null)
  run src "$APP" <<'EOF' | on dst "umask 077; mkdir -p ec2-migration; cat > ec2-migration/erp.ecosystem.json"
ecosystem_json "$1"
EOF
  run dst "$APP_DIR" "$src_ssl" <<'EOF'
dir=$1
node -e '
  const fs = require("fs"); const f = process.argv[1]; const j = JSON.parse(fs.readFileSync(f));
  for (const a of j.apps) {
    if (a.nodeVersion) {
      const own = "/opt/node/v" + a.nodeVersion + "/bin/node";
      if (process.versions.node === a.nodeVersion) a.interpreter = process.execPath;
      else if (fs.existsSync(own)) a.interpreter = own;
      else { console.error("STOP: Node " + a.nodeVersion + " is missing. Run prepare."); process.exit(1); }
      delete a.nodeVersion;
    }
    if (!fs.existsSync(a.script)) { console.error("STOP: start file missing: " + a.script); process.exit(1); }
  }
  fs.writeFileSync(f, JSON.stringify(j, null, 2), { mode: 0o600 });
' "$M/erp.ecosystem.json"
if [ "$(openssl version | cut -d' ' -f2 | cut -d. -f1)" != "$2" ]; then
  echo "-- rebuilding the Prisma client for this server"
  cd "$dir"
  version=$(node -p 'require("./package.json").devDependencies.prisma')
  npx --yes "prisma@$version" generate
fi
echo "files copied"
EOF
}

# ---------------------------------------------------------------- start / stop on server 3

start_target() {
  run dst "$APP" "$PORT" <<'EOF'
pm2 delete "$1" >/dev/null 2>&1 || true
pm2 start "$M/erp.ecosystem.json" >/dev/null
for i in $(seq 1 30); do
  if curl -fsS -m 3 "http://127.0.0.1:$2/api/v1/health" 2>/dev/null | grep -q '"db":"ok"'; then echo "app healthy on server 3"; exit 0; fi
  sleep 2
done
echo "STOP: the app did not become healthy. On server 3 run: pm2 logs $1"
exit 1
EOF
}

stop_target() {
  run dst "$APP" "$APP_DIR" <<'EOF'
if [ -f "$2/.ec2-migration" ]; then pm2 delete "$1" >/dev/null 2>&1 || true; pm2 save >/dev/null; fi
EOF
}

public_health() { # domain
  curl -fsS -m 15 "https://$1$PUBLIC_PREFIX/api/v1/health" 2>/dev/null | grep -q '"db":"ok"'
}

cmd_copy() {
  guard_not_live
  cmd_check
  confirm "Practice copy: server 1 is only read. The ERP database and folder on server 3 are replaced." COPY
  copy_db 0
  copy_files
  say "Copied. The app is NOT started on server 3."
}

cmd_test() {
  guard_not_live
  confirm "Start the copied app on server 3 for a health check, then stop it.
It runs on a copy of real data: queued jobs may SEND REAL EMAILS or messages while it is up." TEST
  trap 'stop_target || warn "Could not stop the test app. On server 3 run: pm2 delete $APP"' EXIT
  start_target
  say "Test passed. Stopping the test app."
}

# ---------------------------------------------------------------- Nginx on server 3

# No DNS change and no new certificate: the ERP path is added inside the HTTPS
# site that already serves NEW_DOMAIN. The rest of that site is left as it is.
cmd_web() {
  confirm "On server 3: add $PUBLIC_PREFIX/ to the existing Nginx site of $NEW_DOMAIN." WEB
  run dst "$NEW_DOMAIN" "$PORT" "$PUBLIC_PREFIX" <<'EOF'
domain=$1 port=$2 prefix=$3
snippet=/etc/nginx/erp-api.location
mkdir -p "$M"
pattern="^[[:space:]]*server_name([[:space:]]+[^;[:space:]]+)*[[:space:]]+${domain//./\\.}([[:space:]]|;)"
files=$(sudo nginx -T 2>/dev/null | sed -n 's/^# configuration file \(.*\):$/\1/p' | while read -r f; do
  if sudo grep -Eq "$pattern" "$f"; then sudo readlink -f "$f"; fi
done | sort -u)
[ -n "$files" ] || { echo "STOP: no Nginx site with 'server_name $domain' was found"; exit 1; }
if sudo test -e "$snippet" && [ ! -f "$M/created-nginx" ]; then echo "STOP: $snippet already exists"; exit 1; fi
for f in $files; do
  if ! sudo grep -qF "include $snippet;" "$f" && sudo grep -Eq "location[^{#]*[[:space:]]$prefix(/|[[:space:]{])" "$f"; then
    echo "STOP: $f already has a location for $prefix"; exit 1
  fi
done

sed "s|__PREFIX__|$prefix|; s|__PORT__|$port|" <<'NGINX' | sudo tee "$snippet" >/dev/null
# ERP API (added by ops/ec2-migration)
location ^~ __PREFIX__/ {
    if ($scheme != https) { return 301 https://$host$request_uri; }
    client_max_body_size 25m;
    proxy_pass http://127.0.0.1:__PORT__/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    # Same headers as server 1: X-Forwarded-For passes through unchanged, so the
    # API (TRUST_PROXY) sees the same client address as before.
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
NGINX
touch "$M/created-nginx"

changed=""
for f in $files; do
  if sudo grep -qF "include $snippet;" "$f"; then continue; fi
  sudo cp -p "$f" "$M/nginx-before-erp-$(basename "$f")"
  sudo sed -i -E "/$pattern/a\\    include $snippet;" "$f"
  changed="$changed $f"
  echo "added to $f (backup in $M)"
done
if ! out=$(sudo nginx -t 2>&1); then
  echo "$out"
  for f in $changed; do sudo cp -p "$M/nginx-before-erp-$(basename "$f")" "$f"; done
  echo "STOP: Nginx rejected the change; the site file was restored"; exit 1
fi
sudo systemctl reload nginx
sleep 2
code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 --resolve "$domain:443:127.0.0.1" "https://$domain$prefix/api/v1/health" || true)
case $code in
  200 | 502) echo "web ready (HTTP $code; 502 is normal until the app runs here)" ;;
  *) echo "STOP: expected HTTP 502 or 200 from $prefix/, got $code. Check the site file."; exit 1 ;;
esac
EOF
}

# ---------------------------------------------------------------- cutover / rollback

start_source() {
  run src "$APP" <<'EOF'
pm2 delete erp-forwarder >/dev/null 2>&1 || true
if [ -n "$(app_info "$1")" ]; then pm2 restart "$1" >/dev/null; else pm2 start "$M/erp.ecosystem.json" >/dev/null; fi
pm2 save >/dev/null
echo "app running on server 1 again"
EOF
}

cmd_forward() {
  local state
  state=$(run dst <<'EOF'
if [ -f "$M/LIVE" ]; then echo live; fi
EOF
  )
  [ "$state" = live ] || die "Server 3 is not live. Run cutover first."
  say "Forwarding the old address from server 1 to server 3"
  on src "mkdir -p ec2-migration && cat > ec2-migration/forwarder.js" <"$HERE/forwarder.js"
  run src "$APP" "$PORT" "$NEW_DOMAIN" "$PUBLIC_PREFIX" <<'EOF'
# remove the old app from PM2 so a reboot can never start it against the old data
pm2 delete "$1" >/dev/null 2>&1 || true
pm2 delete erp-forwarder >/dev/null 2>&1 || true
pm2 start "$M/forwarder.js" --name erp-forwarder -- "$2" "$3" "$4" >/dev/null
pm2 save >/dev/null
EOF
  sleep 3
  public_health "$OLD_DOMAIN" || die "https://$OLD_DOMAIN$PUBLIC_PREFIX does not answer yet. On server 1: pm2 logs erp-forwarder"
  echo "  old address works through the new server"
}

CUTOVER_ACTIVE=0
undo_cutover() {
  [ "$CUTOVER_ACTIVE" = 1 ] || return 0
  CUTOVER_ACTIVE=0
  warn "Cutover failed. Putting the app back on server 1."
  stop_target || warn "Could not stop the app on server 3: run 'pm2 delete $APP' there"
  start_source || warn "COULD NOT RESTART server 1. Log in there and run: pm2 restart $APP"
}

cmd_cutover() {
  load_db
  guard_not_live
  cmd_check
  curl -sS -m 15 -o /dev/null "https://$NEW_DOMAIN$PUBLIC_PREFIX/api/v1/health" || die "HTTPS for $NEW_DOMAIN is not ready. Run the web step."
  on dst "test -f ec2-migration/erp.ecosystem.json" </dev/null || die "Run the copy step first"
  confirm "CUTOVER: the ERP goes offline now, until server 3 is healthy.
Switch off any ERP cron jobs on server 1 first, and make sure nobody is deploying." CUTOVER

  run src "$APP" <<'EOF'
write_ecosystem "$1" "$M/erp.ecosystem.json"   # saved for rollback
EOF
  CUTOVER_ACTIVE=1
  trap undo_cutover EXIT
  say "Stopping the app on server 1"
  run src "$APP" <<'EOF'
pm2 stop "$1" >/dev/null
EOF
  stop_target
  copy_db 1
  copy_files
  say "Starting on server 3"
  start_target
  public_health "$NEW_DOMAIN" || die "Healthy on the server, but not through https://$NEW_DOMAIN"
  run dst <<'EOF'
pm2 save >/dev/null
date -u > "$M/LIVE"
EOF
  CUTOVER_ACTIVE=0
  trap - EXIT
  say "Server 3 is live."
  cmd_forward
  say "Next: './migrate.sh frontend', then commit and push the two vercel.json files."
}

cmd_rollback() {
  load_db
  confirm "ROLLBACK to server 1. Anything users entered since cutover stays on server 3
and will NOT be on server 1. A backup of server 3's database is saved first." ROLLBACK
  stop_target
  if [ "$DB_WHERE" != external ]; then
    run dst "$DB_NAME" <<'EOF'
file="$M/after-cutover-$(date +%Y%m%d-%H%M%S).dump"
( umask 077; sudo -u postgres pg_dump -Fc "$1" > "$file" )
echo "server 3 data saved in $file"
EOF
  fi
  start_source
  run dst <<'EOF'
rm -f "$M/LIVE"
EOF
  say "Rolled back. If you already changed the frontend, restore the old address in the vercel.json files and push."
}

# ---------------------------------------------------------------- frontend (local files only)

cmd_frontend() {
  public_health "$NEW_DOMAIN" || die "https://$NEW_DOMAIN is not healthy yet. Finish cutover first."
  local f old="https://$OLD_DOMAIN$PUBLIC_PREFIX/" new="https://$NEW_DOMAIN$PUBLIC_PREFIX/"
  for f in vercel.json apps/web/vercel.json apps/web/.env.production; do
    [ -f "$ROOT/$f" ] || continue
    if grep -qF "$old" "$ROOT/$f"; then
      sed -b -i "s|${old//./\\.}|$new|g" "$ROOT/$f" # -b keeps Windows line endings
      echo "  updated $f"
    fi
  done
  cat <<MSG

Local files changed only. Now, by hand:
  1. Vercel > Project > Settings > Environment Variables: if VITE_API_BASE_URL is
     set to the old address, change it to ${new}api/v1
  2. Commit ONLY these two files, then push (Vercel redeploys). First look at
     'git log origin/main..' because a push also sends any earlier commits:
       git add vercel.json apps/web/vercel.json
       git commit -m "point web at the new API server" -- vercel.json apps/web/vercel.json
  3. In your private deploy script, change the server address and key to server 3.
MSG
}

case "${1:-}" in
  check) cmd_check ;;
  prepare) cmd_prepare ;;
  copy) cmd_copy ;;
  test) cmd_test ;;
  web) cmd_web ;;
  cutover) cmd_cutover ;;
  forward) cmd_forward ;;
  frontend) cmd_frontend ;;
  rollback) cmd_rollback ;;
  *)
    echo "Usage: ./migrate.sh check|prepare|copy|web|test|cutover|forward|frontend|rollback"
    exit 1
    ;;
esac
