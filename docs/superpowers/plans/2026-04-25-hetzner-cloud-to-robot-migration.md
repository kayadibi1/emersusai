# Hetzner Cloud → Robot Migration Runbook

**Goal:** Migrate Emersus prod from Hetzner Cloud (CPX41, 8 vCPU / 16 GB / NBG1) to Hetzner Robot dedicated (Ryzen 9 3900 / 128 GB ECC / 2×1.92 TB NVMe / FSN1-DC15) with **maximum 15 minutes user-facing downtime** and **rollback at every stage**.

**Box:** https://www.hetzner.com/sb/#search=2981848 — ID `2981848`, AMD Ryzen 9 3900 / 128GB DDR4 ECC / 2×1.92TB U.2 NVMe / **HEL1-DC7 (Helsinki)** / €86 ex-VAT (€102.34 incl 19% German VAT until support reclassifies your account as US — see VAT note below). No setup, no minimum term, billed monthly.

**VAT note:** Per Hetzner's published VAT policy, US private customers (outside TX/UT/AZ/CO/NM) pay 0% VAT. Your account is currently misclassified as German/EU. File a ticket with Hetzner support after ordering ("VAT misclassification — US private customer being charged 19% German VAT") with your US address screenshot. They'll fix the classification and credit the VAT overpayment to your account. Future invoices bill at €86/mo flat.

**Strategy:** Postgres physical streaming replication via Hetzner vSwitch (private LAN between NBG1 Cloud and HEL1 Robot — cross-DC adds ~25ms but is fine for async replication). New box runs as standby for hours/days while you stage the rest of the stack in parallel. At cutover: stop apps on old box → wait for replica caught up → promote replica → start apps on new box → flip DNS. If anything fails: revert DNS, restart old apps, ~5 min downtime, no data loss.

---

## Critical pre-flight facts

- **`infra/` is local-only on your desktop** (untracked, gitignored). The new box gets it via `rsync` from your desktop, NOT git.
- **`~/app/.env` is the source of truth for prod secrets** (NOT `.env.local`). Copy verbatim.
- **JWT secret in GoTrue MUST NOT change** or all user sessions invalidate. Carry it forward in the env file.
- **Postgres is 15 with pgvector** — pin Docker image versions identically on new box.
- **Self-hosted Supabase Postgres runs in Docker.** Replication setup edits `postgresql.conf` and `pg_hba.conf` inside the container's data volume.
- **DNS records:** `emersus.ai` (apex), `supabase.emersus.ai`, `studio.emersus.ai` (404 by design — local-only via SSH tunnel, do NOT migrate publicly), `webhook.emersus.ai` if separate.
- **Polar webhook URL is domain-based** → DNS cutover handles it. No Polar dashboard change needed.
- **Google OAuth callback URLs are domain-based** → no Google Cloud Console change.
- **Resend SMTP credentials live in `~/app/.env`** as GoTrue env vars → just copy.
- **`backup-db.sh` daily 05:00 UTC backup is a systemd timer** → recreate on new box.
- **`emersus-worker` pm2 process holds 14 pg-boss handlers + 5 cron schedules** → preserved in DB, comes back automatically once worker starts on new box.
- **Caddy will re-issue Let's Encrypt certs** automatically on new box once DNS points there. Brief HTTPS warning possible during ACME challenge (~30–60 s).
- **`evidence_chunks` cluster-level vacuum tuning is in `postgresql.conf`** — must apply on new box (per-table reloptions are preserved by data restore).

---

## Stage 0 — Pre-flight (T-3d to T-1d, low-pressure prep)

Done at leisure days before the cutover. None of this affects prod.

### 0.1 Lower DNS TTLs to 60 seconds

Default Cloudflare/Route53 TTL is often 3600 s. At cutover you want fast propagation.

- [ ] Log into your DNS provider
- [ ] For each of `emersus.ai`, `supabase.emersus.ai`, `webhook.emersus.ai`: change TTL from current value to **60**
- [ ] Save records. Wait at least the OLD TTL value (≥1 hour) before cutover so resolvers refresh

```bash
# Verify TTL is now 60 from a clean resolver
dig +short emersus.ai @1.1.1.1
dig emersus.ai @1.1.1.1 | grep -E "IN\s+A\s"   # TTL is the second column
```

### 0.2 Order Hetzner Storage Box (offsite backup)

Independent of box choice. Required for proper offsite backup since Robot has no built-in backup.

- [ ] Robot panel → Storage Box → order **BX11** (1 TB, €3.81/mo)
- [ ] Note the SSH/SFTP credentials emailed to you
- [ ] Save creds in `~/app/.env` on **new box** (when it exists) as `STORAGE_BOX_HOST`, `STORAGE_BOX_USER`, `STORAGE_BOX_PASS`

### 0.3 Take a baseline backup-db.sh dump and verify it

You want to know your dump+restore actually works before the cutover, not during.

```bash
# On OLD box
ssh hetzner
~/scripts/backup-db.sh
# Verify the output exists and file size is sane
ls -lh ~/backups/ | tail -3
# Copy a fresh dump to your local desktop as belt-and-suspenders backup
exit
mkdir -p ~/Desktop/emersus-migration-backup
scp hetzner:~/backups/db-$(date -u +%Y%m%d)*.sql.gz ~/Desktop/emersus-migration-backup/
```

### 0.4 Snapshot of `infra/` to your local + Storage Box

Your local desktop is the canonical source. Make a second copy.

```bash
# On your desktop
cd ~/Desktop/emersus
tar czf ~/Desktop/emersus-migration-backup/infra-snapshot-$(date +%Y%m%d).tar.gz infra/
# Verify it extracts cleanly elsewhere
mkdir -p /tmp/infra-test && cd /tmp/infra-test
tar xzf ~/Desktop/emersus-migration-backup/infra-snapshot-*.tar.gz
ls infra/  # should show docker-compose.yml, supabase/, etc.
rm -rf /tmp/infra-test
```

### 0.5 Document current cluster postgresql.conf overrides

The new box starts with default postgres config. You need to know exactly what custom settings exist.

```bash
ssh hetzner
docker exec supabase-db cat /etc/postgresql/postgresql.conf | grep -vE '^#|^$' > ~/migration-pg-config.txt
# Also dump runtime values for shared_buffers, wal_level, etc
docker exec supabase-db psql -U supabase_admin -c "SELECT name, setting, source FROM pg_settings WHERE source NOT IN ('default','override') ORDER BY name;" > ~/migration-pg-runtime.txt
# Copy back to your desktop
exit
scp hetzner:~/migration-pg-config.txt ~/Desktop/emersus-migration-backup/
scp hetzner:~/migration-pg-runtime.txt ~/Desktop/emersus-migration-backup/
```

### 0.6 Document the supabase docker-compose stack version

```bash
ssh hetzner 'cd ~/infra && docker compose ps --format "table {{.Service}}\t{{.Image}}"' > ~/Desktop/emersus-migration-backup/compose-versions.txt
cat ~/Desktop/emersus-migration-backup/compose-versions.txt
# Pin every image tag explicitly in your local infra/docker-compose.yml — no `:latest`
```

### 0.7 Sanity-check DNS records you'll change at cutover

```bash
for r in emersus.ai supabase.emersus.ai webhook.emersus.ai; do
  echo "=== $r ==="
  dig +short A "$r" @1.1.1.1
  dig +short AAAA "$r" @1.1.1.1
done
```

Save these IPs. The current Cloud box IPv4 is `<old-cloud-ip>` (per memory). Confirm.

### 0.8 Pre-write the cutover DNS commands

Whatever provider you use, write the exact API call / panel sequence so cutover-time you're not fumbling. Example for Cloudflare (substitute your record IDs):

```bash
# Edit these once, save to ~/Desktop/emersus-migration-backup/dns-cutover.sh
NEW_IP="<TBD-after-box-ordered>"
for record in emersus.ai supabase.emersus.ai; do
  curl -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID_$record" \
    -H "Authorization: Bearer $CF_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{\"content\":\"$NEW_IP\",\"ttl\":60}"
done
```

---

## Stage 1 — Order box + base OS install (T-1d, ~1.5 hours active)

### 1.1 Order ID 2981848

- [ ] https://www.hetzner.com/sb/#search=2981848 → **Order**
- [ ] Choose: rescue system on first boot (default)
- [ ] Add IPv6 if not already
- [ ] Confirm — should be live in 5–60 minutes
- [ ] Wait for confirmation email with rescue-system root password

### 1.2 First SSH into rescue

```bash
# From your desktop. Replace IP with what Hetzner emailed.
ssh root@<NEW_BOX_IP>   # password from email
```

You're now in Hetzner's rescue Linux. Nothing is installed yet. The drives are uninitialized.

### 1.3 Sanity-check the hardware

```bash
# Inside rescue
lscpu | head -20             # Confirm Ryzen 9 3900, 12C/24T
free -h                      # Confirm 128 GB RAM
lsblk                        # Confirm 2× 1.92 TB NVMe (likely /dev/nvme0n1, /dev/nvme1n1)
dmesg | grep -i ecc          # Confirm ECC RAM detected
```

If any of this is wrong, **STOP** and open a Hetzner ticket. Do not continue installimage on a misconfigured box.

### 1.4 Configure installimage

```bash
# Inside rescue, run installimage
installimage
```

This drops you in a vim editor on the install config. Configure as:

```
DRIVE1 /dev/nvme0n1
DRIVE2 /dev/nvme1n1

SWRAID 1
SWRAIDLEVEL 1

BOOTLOADER grub

HOSTNAME emersus-prod

PART /boot ext4 1024M
PART swap swap   8G
PART /     ext4 all

IMAGE /root/.oldroot/nfs/install/../images/Ubuntu-2404-noble-amd64-base.tar.gz
```

Notes:
- **mdadm RAID 1** across both NVMe — survives one disk failure
- 8 GB swap (light buffer; with 128 GB RAM you almost never use it but it's there)
- Ubuntu 24.04 LTS (Noble) — match what's on the old box if different (run `lsb_release -a` on old box first to confirm)

Save and exit. installimage runs ~10–15 min, will format both drives, build the array, install Ubuntu, configure grub.

### 1.5 First boot into installed OS

```bash
# Wait for install to finish, it will tell you to reboot
reboot
# Wait ~60 seconds, then SSH again
ssh root@<NEW_BOX_IP>
```

You should see fresh Ubuntu 24.04. Verify the array:

```bash
cat /proc/mdstat              # md0 and md1 active, RAID 1, [UU]
mdadm --detail /dev/md0       # state: clean
mdadm --detail /dev/md1
df -h                         # / on /dev/md1, ~1.7 TB available
```

### 1.6 Configure mdadm email alerts

You absolutely need to know if a disk dies.

```bash
apt update && apt install -y mailutils ssmtp
# Configure mdadm to email you on disk failure
echo "MAILADDR <operator-email>" >> /etc/mdadm/mdadm.conf
systemctl enable --now mdmonitor
# Test it works (sends a test email)
mdadm --monitor --scan --test --oneshot
```

(Configuring `ssmtp` against Gmail is a separate side quest — alternatively use Hetzner's built-in server monitoring email.)

### 1.7 Harden the OS

```bash
# Update everything
apt update && apt upgrade -y
apt install -y ufw fail2ban unattended-upgrades vim tmux htop iotop curl wget pigz \
               ripgrep fd-find plocate

# Firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Verify
ufw status verbose

# Fail2ban with sane defaults
systemctl enable --now fail2ban

# Unattended security upgrades (security patches only, never feature updates)
dpkg-reconfigure --priority=low unattended-upgrades

# Timezone
timedatectl set-timezone UTC

# Confirm time sync
timedatectl status   # should say "System clock synchronized: yes"
```

### 1.8 Create the `emersus` user (mirrors old box)

```bash
adduser --disabled-password --gecos "" emersus
usermod -aG sudo,docker emersus  # docker group will exist after Docker install in stage 3
mkdir -p /home/emersus/.ssh
# Paste the same SSH public keys you use on old box
nano /home/emersus/.ssh/authorized_keys
chown -R emersus:emersus /home/emersus/.ssh
chmod 700 /home/emersus/.ssh
chmod 600 /home/emersus/.ssh/authorized_keys
```

### 1.9 Disable root SSH + password auth

```bash
# /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

# In a SEPARATE terminal (don't lose your existing root session yet) test login as emersus
ssh emersus@<NEW_BOX_IP>
# Once confirmed working, exit the root session
```

### 1.10 Add to your local `~/.ssh/config`

```
# ~/.ssh/config (your desktop)
Host hetzner-new
  HostName <NEW_BOX_IP>
  User emersus
  IdentityFile ~/.ssh/id_ed25519   # whatever key you registered
```

Test: `ssh hetzner-new` → should land in `emersus@emersus-prod`.

### 1.11 Stage 1 rollback

If anything went wrong: `installimage` is repeatable. SSH back into rescue (Robot panel → toggle rescue → reboot), re-run installimage with corrected config. **Old box is untouched throughout this stage.**

---

## Stage 2 — vSwitch + private network (T-1d, ~30 min)

This gives you a private LAN between OLD (NBG1 Cloud) and NEW (FSN1 Robot) boxes for the replication tunnel. Free, no egress charge.

### 2.1 Order vSwitch in Robot panel

- [ ] Robot panel → vSwitch → **Create vSwitch**
- [ ] VLAN ID: pick `4000` (any 4000–4091 is valid; pick something memorable)
- [ ] Name: `emersus-migration`
- [ ] **Add server** → select the new Robot box ID 2980340
- [ ] Save

The vSwitch starts in "active" state immediately for Robot.

### 2.2 Add Cloud box to the same vSwitch

vSwitch crosses Cloud↔Robot via a Cloud network attachment.

- [ ] Hetzner Cloud Console → Networks → **Create Network**
- [ ] Name: `emersus-migration`
- [ ] IP range: `10.0.0.0/16`
- [ ] **Subnets** → Add subnet of type **vSwitch**, choose the vSwitch you just made (VLAN 4000)
- [ ] **Servers** → attach your existing Cloud box (`<old-cloud-ip>`)

The Cloud box now has a second NIC on the private network. Verify:

```bash
ssh hetzner   # old box
ip a | grep -E "inet " | grep -v 127.0.0.1
# You should see <old-cloud-ip> (public) AND a new 10.0.x.x (private)
```

### 2.3 Configure private NIC on Robot box

Hetzner Robot boxes don't auto-configure the vSwitch VLAN — you set it up in netplan.

```bash
ssh hetzner-new
sudo -i

# Identify the physical NIC
ip a | grep -E "^[0-9]+:" | grep -v lo
# Likely something like enp0s31f6 or eno1 — note the name

# Replace <PHYNIC> with the real name and <VLAN_ID> with 4000
cat > /etc/netplan/60-vswitch.yaml <<'EOF'
network:
  version: 2
  vlans:
    enp0s31f6.4000:
      id: 4000
      link: enp0s31f6
      mtu: 1400        # IMPORTANT: vSwitch MTU is 1400, not 1500
      addresses:
        - 10.0.1.10/16
EOF

chmod 600 /etc/netplan/60-vswitch.yaml
netplan apply

# Verify
ip a show enp0s31f6.4000   # should show 10.0.1.10/16, MTU 1400
```

### 2.4 Test bidirectional ping over private LAN

```bash
# From new box → old box
ping -c 5 10.0.0.2   # whatever IP Hetzner Cloud assigned to old box's private NIC

# From old box → new box  
ssh hetzner
ping -c 5 10.0.1.10
```

Both should respond, latency should be 5–10 ms (cross-DC NBG1↔FSN1 over Hetzner backbone).

### 2.5 Stage 2 rollback

Issue with vSwitch? Skip it and use public IPs for replication instead. Slightly slower, but functionally fine. Just allow the replication user from the public IP in `pg_hba.conf` instead of the private IP. **Don't expose Postgres port 5432 publicly without firewall rules** — restrict to the new box's specific public IP.

---

## Stage 3 — Build base stack on new box (T-1d, ~1.5 hours)

### 3.1 Install Docker + Compose

```bash
ssh hetzner-new
# Official Docker repo
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu noble stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add emersus to docker group (needed since installimage skipped this if Docker wasn't installed yet)
sudo usermod -aG docker emersus
# Log out and back in for group membership to take effect
exit
ssh hetzner-new
docker run --rm hello-world   # smoke test
```

### 3.2 Install Node.js (matching old box version)

```bash
# First confirm the version on old box
ssh hetzner 'node --version'   # e.g. v20.18.1
# Then on new box, install nvm + matching Node
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20.18.1   # match old box exactly
nvm alias default 20.18.1
node --version
```

### 3.3 Install pm2 + supporting tools

```bash
npm install -g pm2
pm2 --version
# Postgres client (for psql, pg_dump testing) — match Postgres 15
sudo apt install -y postgresql-client-15
psql --version
```

### 3.4 Transfer `infra/` from your desktop

```bash
# On your desktop
cd ~/Desktop/emersus
rsync -avz --progress infra/ hetzner-new:~/infra/
# Verify
ssh hetzner-new 'ls -la ~/infra/'
```

### 3.5 Transfer `~/app/.env` from old box → new box

This is the most security-sensitive step. **The `.env` contains every prod secret: OpenAI API key, Polar tokens, Resend creds, JWT secret, Postgres password, Supabase service role key.** Do NOT log or screenshot.

```bash
# Copy via your desktop as relay, encrypted in transit (SSH both legs)
ssh hetzner 'cat ~/app/.env' > /tmp/emersus-env-tmp
# Inspect the size: 
wc -l /tmp/emersus-env-tmp   # sanity check, should be 30-100 lines
# Transfer to new box
scp /tmp/emersus-env-tmp hetzner-new:~/.env-staging
# Wipe local copy IMMEDIATELY
shred -u /tmp/emersus-env-tmp

# On new box, place into final location
ssh hetzner-new
mkdir -p ~/app
mv ~/.env-staging ~/app/.env
chmod 600 ~/app/.env
ls -la ~/app/.env   # owner emersus, permissions 600
```

### 3.6 Pull all docker images explicitly (no surprise version drift)

```bash
ssh hetzner-new
cd ~/infra
docker compose pull   # pulls all images named in docker-compose.yml
docker images | grep -E "(supabase|postgres|gotrue|realtime|storage|kong)"
```

Verify the postgres image tag matches what you saw on old box in step 0.6.

### 3.7 Apply cluster postgresql.conf overrides

The data dir comes via replication, but `postgresql.conf` (cluster-level config) lives in the docker volume and gets overwritten by the base backup. You'll re-apply your tuning in Stage 4 after replication is set up. For now, just stage the file.

```bash
# On your desktop, check what was on old box (saved in step 0.5)
cat ~/Desktop/emersus-migration-backup/migration-pg-config.txt
```

Take note of these settings to re-apply (typical Emersus tuning per `reference_evidence_chunks_vacuum_tuning`):

```conf
# postgresql.conf settings to preserve from old box
shared_buffers = 4GB                  # bump to 32GB on new box (25% of 128GB)
effective_cache_size = 12GB           # bump to 96GB on new box
maintenance_work_mem = 1GB            # bump to 4GB
work_mem = 32MB                       # consider 64MB on new box
wal_level = logical                   # required by Realtime
max_wal_senders = 10                  
max_replication_slots = 10            
vacuum_cost_limit = 2000              # cluster-level, per the vacuum tuning memo
autovacuum_vacuum_cost_delay = 0
```

You'll write these into the new postgres data dir after streaming replication completes (Stage 4.7).

---

## Stage 4 — Streaming replication setup (T-1d, runs continuously after kickoff)

### 4.1 Prepare OLD box for replication

```bash
ssh hetzner
docker exec -it supabase-db psql -U supabase_admin -d postgres
```

Inside psql:

```sql
-- Verify wal_level is at least 'replica' (logical also works)
SHOW wal_level;
SHOW max_wal_senders;        -- should be ≥ 10
SHOW max_replication_slots;  -- should be ≥ 10

-- If any are too low, ALTER SYSTEM and restart:
-- ALTER SYSTEM SET max_wal_senders = 10;
-- ALTER SYSTEM SET max_replication_slots = 10;
-- (then restart the postgres container — DOWNTIME, ~30s)

-- Create replication user
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '<STRONG_RANDOM_PASSWORD>';

-- Create a replication slot (so WAL is retained even if replica disconnects)
SELECT pg_create_physical_replication_slot('emersus_new_box');
```

Save that password somewhere temporarily (you'll use it twice in the next steps).

### 4.2 Allow replication from new box

```bash
# Edit pg_hba.conf inside the container's data volume
docker exec -it supabase-db bash
# Inside container:
echo "host replication replicator 10.0.1.10/32 md5" >> /var/lib/postgresql/data/pg_hba.conf
exit

# Reload config (no restart needed)
docker exec supabase-db psql -U supabase_admin -c "SELECT pg_reload_conf();"
```

### 4.3 Verify connectivity from new box

```bash
ssh hetzner-new
PGPASSWORD='<STRONG_RANDOM_PASSWORD>' psql -h 10.0.0.2 -U replicator -d postgres -c "SELECT 1;"
# Should return "1". If it fails, check:
#   - pg_hba.conf entry on old box
#   - Postgres is listening on 10.0.0.2 (might be 0.0.0.0 inside docker, which is fine)
#   - vSwitch ping works (Stage 2)
#   - Postgres in old container is bound to 0.0.0.0 (it usually is via Docker port forwarding)
```

If the docker postgres on old box is bound to `127.0.0.1` only, you need to expose it on the private NIC. Check `~/infra/docker-compose.yml` for the postgres service `ports:` entry and adjust to bind to `10.0.0.2:5432:5432` (private IP only) — then `docker compose up -d supabase-db` to restart with new binding.

### 4.4 Stop the docker postgres on new box (it's been running with empty data)

```bash
ssh hetzner-new
cd ~/infra
docker compose stop supabase-db
docker compose rm -f supabase-db   # remove the container
# Identify the postgres data volume
docker volume ls | grep -i db
# Wipe it — you're about to fill it from the base backup
docker volume rm <volume-name>     # e.g. infra_db-data
```

### 4.5 Take base backup from old box → new box

```bash
# Still on new box. This streams the entire data dir from old box.
mkdir -p ~/pg-data-restore
PGPASSWORD='<STRONG_RANDOM_PASSWORD>' pg_basebackup \
  -h 10.0.0.2 \
  -U replicator \
  -D ~/pg-data-restore \
  -P \
  -X stream \
  -R \
  -S emersus_new_box \
  -c fast

# This takes 15 min to several hours depending on DB size and vSwitch throughput
# -P shows progress
# -X stream parallel-streams WAL during backup
# -R writes standby.signal + primary_conninfo automatically
# -S uses the replication slot we created
```

Watch the output. When done, `~/pg-data-restore/` contains a complete byte-for-byte clone of old box's data dir, plus a `standby.signal` file marking it as a read replica.

### 4.6 Move data into the docker volume + start postgres

```bash
# Recreate the docker volume
docker volume create infra_db-data    # match the original volume name

# Find the volume mount path
VOLUME_PATH=$(docker volume inspect infra_db-data --format '{{ .Mountpoint }}')
echo $VOLUME_PATH

# Move (not copy — saves ~30 GB) the restored data into the volume
sudo rsync -avz --progress ~/pg-data-restore/ "$VOLUME_PATH/"
# Verify
sudo ls -la "$VOLUME_PATH/"   # should see PG_VERSION, base/, pg_wal/, etc.

# Free the staging dir
rm -rf ~/pg-data-restore
```

### 4.7 Re-apply cluster postgresql.conf tuning

The base backup brought over the OLD box's `postgresql.conf`. Edit it for new box's bigger RAM:

```bash
sudo vim "$VOLUME_PATH/postgresql.conf"
```

Change these (or append at end — last value wins):

```conf
shared_buffers = 32GB
effective_cache_size = 96GB
maintenance_work_mem = 4GB
work_mem = 64MB
# Keep all other settings as inherited from old box
```

### 4.8 Start postgres as replica

```bash
cd ~/infra
docker compose up -d supabase-db
docker compose logs -f supabase-db
# Look for: "database system is ready to accept read-only connections"
# That's a STANDBY in active state.
```

### 4.9 Verify replication is healthy

```bash
# On NEW box
docker exec supabase-db psql -U supabase_admin -c "SELECT pg_is_in_recovery();"
# Expected: t  (true, this is a replica)

docker exec supabase-db psql -U supabase_admin -c "SELECT pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn();"
# Both should advance over time, and be very close to each other

# On OLD box  
ssh hetzner
docker exec supabase-db psql -U supabase_admin -c "SELECT * FROM pg_stat_replication;"
# Expected: one row with state=streaming, sync_state=async, replication slot 'emersus_new_box'
```

### 4.10 Lag monitoring

Run this periodically — it shows replication lag in bytes and seconds.

```bash
docker exec supabase-db psql -U supabase_admin -c "
SELECT
  client_addr,
  state,
  pg_size_pretty(pg_wal_lsn_diff(sent_lsn, replay_lsn)) AS replay_lag_bytes,
  EXTRACT(EPOCH FROM replay_lag) AS replay_lag_seconds
FROM pg_stat_replication;"
```

Healthy: lag bytes < 16 MB, seconds < 1. Sustained higher = network or new box can't keep up.

### 4.11 Stage 4 rollback

Replication broken? **Old box is fully unaffected.** Drop the replication slot on old box (`SELECT pg_drop_replication_slot('emersus_new_box');`), wipe new box's data volume, re-run `pg_basebackup` from a fresh start. Iterate until clean.

---

## Stage 5 — Build apps + Caddy on new box (T-1d evening, ~1.5 hours)

While replication runs in the background.

### 5.1 Clone the repo

```bash
ssh hetzner-new
cd ~
git clone git@github.com:<your-user>/emersus.git app  # or HTTPS with PAT
cd ~/app
git status   # clean
git log -1   # matches what's on old box
```

### 5.2 `npm ci` (NOT `npm install`)

Per memory `feedback_hetzner_lockfile_drift_recurring`: `npm install` mutates the lockfile and breaks future deploys. Use `npm ci` for clean, lockfile-respecting installs.

```bash
cd ~/app
npm ci
# This takes 2-5 min and produces an exact mirror of the lockfile
```

### 5.3 Configure pm2

```bash
# Generate systemd-style startup script that auto-starts pm2 on boot
sudo env PATH=$PATH:$(which node | xargs dirname) pm2 startup systemd -u emersus --hp /home/emersus
# Copy-paste the command it prints, run it as root

# Verify
systemctl status pm2-emersus   # should be enabled, but not yet running anything
```

### 5.4 DON'T start emersus-api or emersus-worker yet

The DB is read-only (standby). Apps would error out on writes. Wait until promotion in Stage 7.

### 5.5 Build BGE-rerank container (if you use it)

```bash
ssh hetzner 'docker ps | grep bge-rerank'  # confirm it's running on old box, get image
# Replicate on new box
ssh hetzner-new
# Pull the same image
docker pull <BGE_IMAGE_NAME>:<TAG>
# Don't start it yet — it's lightweight, you'll spin it up at cutover
```

### 5.6 Configure Caddy

```bash
# Get the existing Caddyfile from old box
ssh hetzner 'cat /etc/caddy/Caddyfile' > ~/Desktop/emersus-migration-backup/Caddyfile-old
scp ~/Desktop/emersus-migration-backup/Caddyfile-old hetzner-new:/tmp/

# On new box
sudo apt install -y caddy
sudo cp /tmp/Caddyfile-old /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
# Verify there are no IP-hardcoded references — should all be 127.0.0.1 or localhost
# Caddy will manage TLS certs automatically once DNS points here

# Don't enable yet — start in Stage 7
sudo systemctl disable caddy
```

### 5.7 Set up systemd timer for `backup-db.sh`

```bash
ssh hetzner 'cat ~/scripts/backup-db.sh' > /tmp/backup-db.sh
ssh hetzner 'systemctl --user cat emersus-db-backup.timer 2>/dev/null || sudo systemctl cat emersus-db-backup.timer'
# Get the timer + service unit files
# Replicate on new box
scp /tmp/backup-db.sh hetzner-new:~/scripts/
ssh hetzner-new 'chmod +x ~/scripts/backup-db.sh'

# Recreate the systemd timer (assuming it's a system-level timer)
ssh hetzner-new
sudo nano /etc/systemd/system/emersus-db-backup.service
# Paste service unit (matches old box's content)
sudo nano /etc/systemd/system/emersus-db-backup.timer
# Paste timer (OnCalendar=*-*-* 05:00:00)

sudo systemctl daemon-reload
sudo systemctl enable emersus-db-backup.timer
# DO NOT start yet — DB on new box is read-only, dump would still work but might confuse rollback
```

### 5.8 Smoke-test the read-only stack

While DB is still standby, verify everything you can:

```bash
ssh hetzner-new
cd ~/infra

# Bring up everything except the apps (postgres-only is already up)
docker compose up -d gotrue realtime storage kong meta studio
docker compose ps   # all services Up except api/worker

# These services connect to postgres in read-only mode for now —
# auth queries work, but writes would fail. That's expected.
docker compose logs --tail 50 gotrue | grep -i error   # should be empty
docker compose logs --tail 50 realtime | grep -i error
```

If any errors here are non-trivial, debug now (not at cutover).

### 5.9 Stage 5 rollback

Anything wrong? Stop the new-box services. Old box untouched. Iterate.

---

## Stage 6 — Pre-cutover verification (T-1d evening or T+0 morning, ~30 min)

Do this WITHIN 1 HOUR of cutover for accurate state.

- [ ] Replication lag < 1 second sustained for 10+ min:
  ```bash
  ssh hetzner-new
  watch -n 5 'docker exec supabase-db psql -U supabase_admin -tc "SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) AS lag_seconds;"'
  ```
- [ ] All Supabase services up on new box (kong, gotrue, realtime, storage, meta, studio): `docker compose ps`
- [ ] Caddyfile copied, Caddy installed (but not running): `sudo systemctl is-enabled caddy` → `disabled`
- [ ] pm2 startup script enabled: `systemctl status pm2-emersus`
- [ ] `~/app/.env` matches old box (compare hash):
  ```bash
  ssh hetzner       'sha256sum ~/app/.env' 
  ssh hetzner-new   'sha256sum ~/app/.env'
  # Should be IDENTICAL
  ```
- [ ] Replication slot active on old box: `docker exec supabase-db psql -U supabase_admin -c "SELECT * FROM pg_replication_slots;"`
- [ ] DNS TTLs at 60s (verify with dig from clean resolver)
- [ ] You have the DNS update commands ready in `~/Desktop/emersus-migration-backup/dns-cutover.sh`
- [ ] Status page / Discord / X post drafted announcing 15-min maintenance window
- [ ] You have **TWO terminal windows** open: one to old box, one to new box
- [ ] You have a **third terminal** open with `tail -f` ready on `pm2 logs` for new box
- [ ] **Do not be tired or rushed.** Cutover takes 15 min focused. Don't start at 1 AM.

### 6.1 Final pre-cutover checklist

Read out loud:

> "I have a verified replication lag under 1 second. I have the new box ready with all services prepared but not started. I have my DNS cutover script ready with the new IP filled in. I have rollback documented for every stage. I have at least 30 minutes of focused time. **Go.**"

---

## Stage 7 — Cutover (THE maintenance window, ~10–15 min user-facing)

### Pre-cutover: T-5 minutes

```bash
# T-5: Announce maintenance starting in 5 minutes (status page / Discord)
# T-3: Pause GitHub webhook (so an in-flight push doesn't half-deploy mid-cutover)
ssh hetzner 'pm2 stop webhook'
```

### T+0:00 — Stop apps on old box (chat goes down here)

```bash
ssh hetzner
pm2 stop emersus-api emersus-worker
pm2 list   # both should show "stopped"
```

User-facing chat is now down. Timer starts.

### T+0:01 — Drain in-flight transactions

```bash
docker exec supabase-db psql -U supabase_admin -c "
SELECT count(*) FROM pg_stat_activity 
WHERE state = 'active' AND application_name NOT LIKE '%autovacuum%';"
# Wait until this returns 0 (should be near-instant since apps are stopped)
```

### T+0:02 — Force a final WAL switch

```bash
docker exec supabase-db psql -U supabase_admin -c "SELECT pg_switch_wal();"
# This flushes the current WAL segment so it ships to the standby
```

### T+0:03 — Verify replica caught up to old primary

```bash
# On OLD box
PRIMARY_LSN=$(docker exec supabase-db psql -U supabase_admin -tc "SELECT pg_current_wal_flush_lsn();")
echo "Primary LSN: $PRIMARY_LSN"

# On NEW box
ssh hetzner-new
REPLICA_LSN=$(docker exec supabase-db psql -U supabase_admin -tc "SELECT pg_last_wal_replay_lsn();")
echo "Replica LSN: $REPLICA_LSN"

# These should be IDENTICAL or replica should be ahead. If primary > replica, wait 30s and retry.
```

### T+0:04 — Promote replica to standalone primary

```bash
# On NEW box
docker exec supabase-db psql -U supabase_admin -c "SELECT pg_promote();"
# Verify
docker exec supabase-db psql -U supabase_admin -c "SELECT pg_is_in_recovery();"
# Expected: f  (false — this is now a primary)
```

The new box is now the writable database of record. **There is no going back to the old box's DB without a fresh backup restore.** This is the point of no return for the database layer.

### T+0:05 — Drop replication slot on (former) primary to avoid WAL bloat

```bash
ssh hetzner
docker exec supabase-db psql -U supabase_admin -c "SELECT pg_drop_replication_slot('emersus_new_box');"
```

### T+0:06 — Start full Supabase stack on new box

```bash
ssh hetzner-new
cd ~/infra
# These were already running but verify
docker compose ps
# Make sure realtime is up — it needs to recreate logical replication slots after promote
docker compose restart realtime
docker compose logs --tail 30 realtime | grep -i "started\|listening"
```

### T+0:07 — Start emersus-api + emersus-worker

```bash
ssh hetzner-new
cd ~/app
pm2 start ecosystem.config.cjs   # or however you start them on old box
pm2 list   # both online
pm2 save   # persist for systemd
```

### T+0:08 — Start Caddy

```bash
sudo systemctl enable --now caddy
sudo systemctl status caddy   # active (running)
```

Caddy will START acquiring TLS certs but won't succeed until DNS points to the new box. Hold on.

### T+0:09 — Smoke test on new box (still using old DNS!)

Hit the new box directly via IP, with `Host:` header to spoof DNS:

```bash
# From your desktop
NEW_IP=<NEW_BOX_IP>
curl -sS -k --resolve emersus.ai:443:$NEW_IP https://emersus.ai/api/health
# Expected: 200 OK or whatever your health endpoint returns

curl -sS -k --resolve supabase.emersus.ai:443:$NEW_IP https://supabase.emersus.ai/auth/v1/health
# Expected: 200 OK from gotrue
```

If either fails: **STOP. Roll back via Stage 7 rollback (below) before flipping DNS.**

### T+0:10 — Flip DNS

```bash
# From your desktop
bash ~/Desktop/emersus-migration-backup/dns-cutover.sh
# Or do it manually in your DNS provider's UI

# Verify propagation
sleep 30
dig +short emersus.ai @1.1.1.1
dig +short emersus.ai @8.8.8.8
dig +short supabase.emersus.ai @1.1.1.1
# All should return the new IP within ~60s (TTL was 60s)
```

### T+0:11 — Wait for Caddy to issue TLS certs

```bash
ssh hetzner-new
sudo journalctl -u caddy --since "1 minute ago" -f
# Look for "certificate obtained" lines for each domain
# Takes 10-30s once DNS is resolving correctly
```

### T+0:12 — Real smoke test from public internet

```bash
# From your desktop
curl -sSI https://emersus.ai/api/health   # 200, valid TLS
curl -sSI https://supabase.emersus.ai/auth/v1/health
# Open https://emersus.ai in your browser — log in, send a chat message, verify it works
```

### T+0:13 — Re-enable GitHub webhook

```bash
# Recreate the webhook on new box
ssh hetzner-new
# Copy the webhook.js or however it's set up
scp hetzner:~/webhook.js hetzner-new:~/
pm2 start webhook
pm2 save
```

### T+0:14 — Announce cutover complete

```bash
# Post to status page / Discord / X
```

User-facing downtime: **~10 minutes** if everything went smoothly.

### Stage 7 rollback decision tree

| What broke | Rollback action | Downtime |
|---|---|---|
| Replica fails to promote (T+0:04) | Restart old box's apps. Replica is fine to leave as-is for retry tomorrow. | ~3 min |
| New box services fail to start (T+0:06–07) | Stop new box services. Restart old apps on old box. DNS not flipped yet. | ~5 min |
| Smoke test fails BEFORE DNS flip (T+0:09) | Stop new box, restart old box apps. Investigate offline. | ~5 min |
| DNS flipped, new box has issues (T+0:10–12) | Revert DNS to old IP. Restart old apps on old box (DB rollback caveat below). | ~5 min + DNS propagation |

**Critical DB rollback caveat:** Once you promote the replica (T+0:04), the new box accepts writes. If you then realize you need to roll back to old box, **you lose any writes that happened between promote and rollback**. Mitigation: at T+0:04 the apps are not yet started, so no writes happen until T+0:07. **Window of write-loss risk is T+0:07 to T+0:13** — if you need to roll back during this window, you accept losing those few minutes of writes (chat messages, user actions). For a botched cutover this is the right tradeoff: a few lost messages > a corrupt DB.

If rollback needed past T+0:13 (apps running on new box for >5 min): cutover succeeded. Do NOT roll back. Fix forward.

---

## Stage 8 — Post-cutover monitoring (T+0 to T+7d)

### First hour

- [ ] `pm2 logs emersus-api --lines 200` — no error spikes
- [ ] `pm2 logs emersus-worker --lines 200` — handlers initialized, heartbeat ticking
- [ ] Sentry dashboard — no error rate spike
- [ ] PostHog — chat events flowing
- [ ] Manually test signup with a new email (verifies Resend SMTP, GoTrue templates)
- [ ] Manually test Google OAuth login (verifies callback URL still works)
- [ ] Manually test Polar checkout flow if possible (small charge with refund) — verifies webhook
- [ ] Verify `pg_stat_activity` count is reasonable (not stuck high — connection leak)

### First 24h

- [ ] Daily backup-db.sh fires at 05:00 UTC: `journalctl -u emersus-db-backup.service --since today`
- [ ] HNSW index queries returning expected latency (run a chat query, check logs for retrieval ms)
- [ ] pg-boss cron jobs firing on schedule: `docker exec supabase-db psql -U supabase_admin -c "SELECT * FROM boss.schedule;"`
- [ ] Realtime subscriptions reconnect cleanly from clients (verify with browser → chat page)
- [ ] No replication slot accumulation on new box: `pg_replication_slots` should be empty (Realtime creates its own as needed)

### First week

- [ ] Run `grounding-eval.js` and compare to baseline (from memory: command in `reference_grounding_eval_commands`)
- [ ] Run retrieval matrix (`scripts/eval/bench-matrix.js`) and compare to pre-migration baseline
- [ ] Verify nightly TTL archival cron firing (cross-thread memory subsystem)
- [ ] Old box: keep running, but services stopped. It's your fallback.

---

## Stage 9 — Decommission (T+7d to T+14d)

Only after a clean week.

- [ ] T+7d: Final dump from old box into archive on Storage Box (just-in-case for any compliance/audit need)
- [ ] T+8d: SSH to old box, `pm2 delete all`, `docker compose down -v`
- [ ] T+8d: Hetzner Cloud panel → Cancel CPX41
- [ ] T+8d: Remove old box's vSwitch attachment
- [ ] T+8d: Remove `hetzner` host from local `~/.ssh/config` (keep `hetzner-new` as `hetzner`)
- [ ] T+8d: Update memory file `reference_hetzner_server.md` with new IP
- [ ] T+8d: Update memory file `reference_hetzner_ssh.md` if SSH alias changed
- [ ] T+8d: Update CLAUDE.md if specs/IP referenced

---

## Gotcha appendix (read before each stage)

### Self-hosted Supabase specifics

- `supabase_admin` role REQUIRED for any DDL on auth.* tables (per `project_supabase_admin_role`). Use `-U supabase_admin` not `-U postgres` for migrations.
- `wal_level=logical` must be preserved — Realtime needs it.
- After promote, Realtime recreates its own logical replication slots automatically. Don't pre-create them.
- `pg_hba.conf` lives at `/var/lib/postgresql/data/pg_hba.conf` inside container.

### Caddy + Let's Encrypt

- Caddy stores cert state in `/var/lib/caddy/`. **Do NOT migrate this state file** — let new Caddy re-issue from scratch. Old certs would be tied to old IP's ACME validation history.
- ACME http-01 challenge requires port 80 reachable and DNS pointing to new box. That's why the order is: DNS flip → wait → Caddy gets certs.
- If certs fail to issue: check `journalctl -u caddy` for the specific error. Common: rate-limited (50 certs/week per domain on Let's Encrypt), DNS not propagated yet, port 80 firewalled.

### DNS

- Lower TTL ≥1 hour before cutover. The TTL the resolver caches is the CURRENT TTL value at fetch time.
- Some users behind ISP DNS may see stale entries for 1–2 hours after TTL change (lazy resolvers). Acceptable.
- Cloudflare proxy mode (orange cloud): if proxy ON, ignore A record IP visible publicly — Cloudflare proxies it. Make sure proxy mode is consistent old → new.

### `infra/` is gitignored

- All `.md` files and `infra/` are local-only by design (per `feedback_local_md_docs` and CLAUDE.md). Transfer via rsync from your desktop, NEVER `git add` them.
- After migration: keep editing `infra/` on your desktop, rsync changes up. Same workflow as before.

### `npm install` vs `npm ci`

- Per `feedback_hetzner_lockfile_drift_recurring`: `npm install` mutates the lockfile and breaks the next webhook deploy ("local changes would be overwritten by merge"). Always `npm ci` on the new box for the initial setup. Webhook auto-deploy uses whatever's in `~/webhook.js` — verify it uses `npm ci` not `npm install`, or accept the recurring stash+pull dance.

### pm2 + .env loading

- Per `reference_pm2_env_gotcha`: processes that read `process.env` directly (like `webhook.js`) need `pm2 stop` + `pm2 delete` + start with `--env` flag. Processes using `api/lib/load-env.js` are fine with `pm2 restart --update-env`.

### vSwitch MTU

- vSwitch MTU is **1400**, not 1500. Set this in netplan or large packets fragment silently. Common mistake.

### evidence_chunks vacuum

- Cluster-level vacuum settings (`vacuum_cost_limit`, `autovacuum_vacuum_cost_delay`) live in `postgresql.conf` — apply on new box (Stage 4.7).
- Per-table reloptions (`scale_factor=0.05` etc) ride along in the table definition — preserved by data restore. No action needed.

### Time zones

- Old box might be in `Europe/Berlin` or `UTC`. Check: `ssh hetzner 'timedatectl'`. Match on new box (Stage 1.7 sets UTC; if old was Berlin, match it).

### supabase_admin password

- The role exists in the data restore. Its password came from old box's setup. You'll connect with the same password — no need to reset.

### Storage Box for backups

- Mount via SSHFS or use Borg/restic. SSHFS is simpler:
  ```bash
  sudo apt install -y sshfs
  mkdir ~/storage-box
  sshfs <user>@<host>:/ ~/storage-box -o reconnect,IdentityFile=~/.ssh/id_ed25519
  ```
- Modify `backup-db.sh` to push to `~/storage-box/emersus-backups/` after creating the local dump.

### Old box keepalive

- Don't cancel old Cloud box for 7 days. €30 of "insurance" is worth it.
- After 7d clean run + final archive, cancel.

---

## Decision log (fill during/after migration)

- **Box ordered at:** _________________ (timestamp, who clicked Order)
- **vSwitch VLAN ID:** 4000 (or actual)
- **Replication started at:** _________________
- **Replication caught up at:** _________________
- **Cutover window:** _________________ to _________________
- **DNS flipped at:** _________________
- **Smoke tests passed at:** _________________
- **First chat message on new box:** _________________
- **Issues encountered:** ___________________________________
- **Old box decommissioned at:** _________________
