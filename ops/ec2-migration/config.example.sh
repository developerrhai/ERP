# Copy this file to config.sh (git-ignored) and set the two key paths.
# Paths use Git Bash style: C:\Users\you\keys\a.pem  ->  /c/Users/you/keys/a.pem

SRC_HOST="13.204.199.132"   # server 1, HealthCoreX (move FROM)
DST_HOST="3.110.78.177"     # server 3, Institutemanage (move TO)
SSH_USER="ec2-user"
SRC_KEY="/c/path/to/server1.pem"
DST_KEY="/c/path/to/server3.pem"

APP="sawant-erp-backend"             # PM2 process name
APP_DIR="/app/sawant-erp-backend"    # same folder on both servers
PORT="5010"

OLD_DOMAIN="institute-api.rhaitech.online"   # stays on server 1 (other apps use it)
NEW_DOMAIN="dnyansagarclasses.rhaitech.online" # server 3's existing HTTPS site (no DNS change)
PUBLIC_PREFIX="/sawant-erp"                  # https://<domain>/sawant-erp/api/...

SWAP_MB="2048"  # swap file made on server 3 if it has none
