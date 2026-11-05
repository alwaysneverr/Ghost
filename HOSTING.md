# Running Ghost 24/7 on Debian

This guide sets Ghost up on a Debian machine so she:

- starts when the machine boots, without anyone logging in
- restarts by herself if she crashes
- keeps her models loaded on the graphics card

It's written for Debian 12 (bookworm) and 13 (trixie). Run every command on the Debian machine
unless the step says otherwise. Every command assumes your own account has `sudo`.

There are two ways to set it up:

| Setup | Debian machine runs | Steps |
| --- | --- | --- |
| **A. One machine** | Ghost and Ollama. It needs an NVIDIA card with 8 GB or more. | 0–10, skipping 3b |
| **B. Split** | Only Ghost. Ollama stays on your Windows PC with the graphics card. | 0, 2, 3b, 4–10, skipping 1 and 3 |

Setup B suits a small machine with no graphics card, such as a mini PC. Ghost on her own needs
about 300 MB of RAM and almost no CPU, so 4–8 GB is plenty. A server install with no desktop
(untick everything except *SSH server* and *standard system utilities* in the installer) leaves
the most of it free.

Here's what you end up with:

| Piece | Runs as | Started by | Where |
| --- | --- | --- | --- |
| Ollama (A) | `ollama` user | `ollama.service` | models in `/usr/share/ollama/.ollama/models` |
| Ollama (B) | you, on Windows | signing in to Windows | models in `%USERPROFILE%\.ollama\models` |
| Ghost | `ghost` user | `ghost.service` | `/opt/ghost/Ghost`, writing only to its `data/` |

Nothing needs to reach either machine from the internet. Ghost connects out to Discord, so you
don't need to forward any ports. In setup A, Ollama only listens on `127.0.0.1`. In setup B, it
listens on your home network, or on Tailscale, and step 3b limits it to the Debian machine.

---

## 0. Before you start

**Hardware.** In setup B, this is about the Windows PC, which already runs her, so skip ahead.
`qwen3:8b` with a 16k context needs about **8 GB of graphics memory**. You also need
about 16 GB of RAM and 10 GB of free disk for the models.

On a smaller card, or with no card, it still works but slowly: 30 seconds or more per reply on the
CPU. If that's your situation:

- set `OLLAMA_MODEL=qwen3:4b` and a smaller `OLLAMA_NUM_CTX` (8192) in `.env`
- expect her to sound less like herself, since the prompt was tuned on the 8b model

**Only one Ghost at a time.** Two copies running with the same token both receive every message,
and both answer. Stop the bot on your Windows PC before step 6, and don't start it there again.

**Use a new token.** Reset the bot token in the Developer Portal (**Bot → Reset Token**). Type it
straight into the new machine's `.env` in step 6, instead of copying the old `.env` across.

---

## 1. NVIDIA driver

Skip this step if you have no NVIDIA card.

Debian keeps the driver in its `contrib` and `non-free` sections, which are off by default.
Turn them on:

- **Debian 13:** edit `/etc/apt/sources.list.d/debian.sources`. On every `Components:` line, make
  it read:
  ```
  Components: main contrib non-free non-free-firmware
  ```
- **Debian 12:** edit `/etc/apt/sources.list`. At the end of every `deb` line, add
  `contrib non-free non-free-firmware` after `main`.

Then install the driver and reboot:

```sh
sudo apt update
sudo apt install linux-headers-amd64 nvidia-driver firmware-misc-nonfree nvidia-smi
sudo reboot
```

Once it's back up, check the driver:

```sh
nvidia-smi
```

It should show your card and a driver version. If it says it couldn't communicate with the driver,
**Secure Boot** is usually the reason, because it blocks the driver until its key is enrolled.
You have two fixes:

- turn Secure Boot off in the BIOS, or
- run `sudo mokutil --import /var/lib/dkms/mok.pub`, choose a one-time password, then reboot and
  pick **Enroll MOK** on the blue screen.

Install the driver **before** Ollama. Ollama's installer adds NVIDIA's own driver packages if it
can't find `nvidia-smi`, and those clash with Debian's.

---

## 2. The tools

```sh
sudo apt install git curl ca-certificates sqlite3
```

**Node.js 22.13 or newer** is required. Debian's own package is too old (18 on Debian 12, 20 on
Debian 13), so install Node 22 from NodeSource:

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x -o nodesource_setup.sh
less nodesource_setup.sh          # read what it does before running it as root
sudo bash nodesource_setup.sh
sudo apt install nodejs
node --version                    # v22.13 or newer
```

---

## 3. Ollama

Download the installer, read it, then run it:

```sh
curl -fsSL https://ollama.com/install.sh -o ollama_install.sh
less ollama_install.sh
sh ollama_install.sh
```

The installer creates an `ollama` user and an `ollama.service` that starts at boot. Next, download
the models and check that Ollama is using the card:

```sh
ollama pull qwen3:8b
ollama pull bge-m3
ollama run qwen3:8b "say hi"
ollama ps                         # PROCESSOR should say 100% GPU
```

If `ollama ps` says `CPU`, Ollama can't see the card. Run `nvidia-smi` again, then
`sudo systemctl restart ollama`.

**Optional: let her reply check run alongside the reply.** Ghost asks the chat model whether each
reply pushes self-harm (see the guide's section on habits). With a 12 GB card, two requests at
once removes the 0.9 seconds that check adds. To turn it on:

```sh
sudo systemctl edit ollama
```

In the editor, add these lines above the line saying the rest of the file will be discarded:

```ini
[Service]
Environment="OLLAMA_NUM_PARALLEL=2"
```

Then restart Ollama:

```sh
sudo systemctl restart ollama
```

`qwen3:8b` then uses about 9.8 GB. Leave this off on cards smaller than 12 GB.

---

## 3b. Or: Ollama on your Windows PC

Only for setup B. Ollama is already installed there with both models. It needs three changes:

1. it listens on the home network instead of only on the PC itself
2. only the Debian machine can reach it
3. it's running whenever the PC is on

**Fixed addresses for both machines.** Ghost finds Ollama by its IP address, and the firewall rule
below allows the Debian machine by its IP. In your router's settings, look for *DHCP reservation*
(or *static lease*) and reserve an address for each machine. The examples here use:

- `192.168.1.10` for the Windows PC
- `192.168.1.20` for the Debian machine

Use a cable rather than Wi-Fi if you can, especially on the Windows PC.

**Make Ollama listen on the network.** On Windows, in PowerShell:

```powershell
[Environment]::SetEnvironmentVariable('OLLAMA_HOST', '0.0.0.0', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_NUM_PARALLEL', '2', 'User')   # optional, see step 3
```

Then right-click the llama in the system tray, choose **Quit Ollama**, and start Ollama again from
the Start menu so it picks the settings up.

**Let only the Debian machine in.** Ollama has no password, so anything that can reach the port
can use it. In PowerShell **as administrator**:

```powershell
New-NetFirewallRule -DisplayName 'Ollama from Ghost' -Direction Inbound -Protocol TCP `
  -LocalPort 11434 -RemoteAddress 192.168.1.20 -Profile Private -Action Allow
```

That rule depends on the network itself. Your home network has to be set to **Private** in
**Settings → Network & internet → (your connection)**. If Windows ever asks whether to let
`ollama.exe` through the firewall, click **Cancel**, because allowing it there would let in every
device on the network.

**Check it from Debian:**

```sh
curl http://192.168.1.10:11434/api/tags
```

It should list `qwen3:8b` and `bge-m3`. If it hangs, check three things: the firewall rule, that
the network is Private, and that Ollama was restarted after setting `OLLAMA_HOST`.

### With Tailscale instead

[Tailscale](https://tailscale.com) puts both machines on a private network of their own, which
works whichever networks they're on. It replaces two parts of 3b: the fixed addresses and the
firewall rule. Everything else in 3b still applies, including `OLLAMA_HOST`, the power settings and
staying signed in. What you get:

- **The Debian machine can live anywhere,** such as at a friend's house or on another network, and
  still reach Ollama. No ports are opened on either router.
- **Chat text is encrypted** between the machines. On a plain home network, it travels as ordinary
  HTTP.
- **No router settings.** Each machine keeps the same Tailscale address (`100.x.y.z`) wherever it is.

**1. Install it on both machines,** signed in to the same Tailscale account.

- **Windows:** install it from <https://tailscale.com/download> and sign in. Then, in its tray menu,
  turn on **Run unattended** (under *Preferences* or *Settings*). Without it, Tailscale is tied
  to whoever is using Windows right now, so it disconnects if someone else signs in to the PC with
  another account.
- **Debian:**
  ```sh
  curl -fsSL https://tailscale.com/install.sh -o tailscale_install.sh
  less tailscale_install.sh
  sh tailscale_install.sh
  sudo tailscale up            # prints a link; open it on any device and sign in
  ```
  This installs `tailscaled.service`, which starts at boot by itself.

**2. Turn off key expiry for both machines.** By default, every machine has to sign in to Tailscale
again after 180 days. Until it does, it's cut off, and Ghost loses Ollama without warning. In the
admin console (<https://login.tailscale.com/admin/machines>), click **⋯** next to each machine and
choose **Disable key expiry**.

**3. Find the Windows PC's Tailscale address.** On Windows:

```powershell
tailscale ip -4                   # e.g. 100.101.102.103
```

Run the same command on Debian for its own address, which the next step needs.

**4. Allow only the Debian machine, and only over Tailscale.** In PowerShell **as administrator**,
use the Debian machine's Tailscale address. If you already made the home-network rule from 3b,
delete it first (`Remove-NetFirewallRule -DisplayName 'Ollama from Ghost'`).

```powershell
New-NetFirewallRule -DisplayName 'Ollama from Ghost (Tailscale)' -Direction Inbound -Protocol TCP `
  -LocalPort 11434 -RemoteAddress 100.64.0.20 -InterfaceAlias Tailscale -Profile Any -Action Allow
```

Here's why the rule is built this way:

- **`-InterfaceAlias Tailscale`** keeps it to the Tailscale adapter, so nothing on your home
  network gets in.
- **`-Profile Any`** is needed because Windows doesn't always mark the Tailscale adapter as a
  Private network.

**5. Check it from Debian:**

```sh
tailscale ping 100.101.102.103    # "via DERP" means relayed: slower, but still works
curl http://100.101.102.103:11434/api/tags
```

**6. In Ghost's `.env`** (step 6), use the Tailscale address:

```ini
OLLAMA_URL=http://100.101.102.103:11434
```

With MagicDNS on, the PC's name works too (`http://my-pc:11434`). The address keeps working even if
DNS acts up, so it's the safer choice.

**7. In `ghost.service`** (step 7), you can wait for Tailscale before she starts. That saves the
"Ollama unreachable" warning at boot:

```ini
Wants=network-online.target tailscaled.service
After=network-online.target tailscaled.service
```

**Optional: tighter rules in Tailscale itself.** By default, every machine on your account can
reach every other one. The Windows firewall rule already limits who reaches Ollama, which is
enough for a tailnet only you use. If you share the tailnet with other people, also restrict port
11434 in the admin console under **Access controls**. Don't turn on **Funnel** for the Windows PC:
that would put Ollama on the public internet.

**Optional: SSH over Tailscale only.** Step 10's firewall then doesn't need to open SSH to your
home network at all:

```sh
sudo ufw allow in on tailscale0 to any port 22 proto tcp
sudo ufw delete allow OpenSSH     # if you added it earlier
```

Then `ssh you@<debian's Tailscale address>` from any of your devices. Keep a keyboard and screen
handy the first time, in case you lock yourself out.

---

**Keep it running.** Ghost can't chat while the Windows PC is off, asleep or signed out:

- Ollama on Windows starts when you **sign in**, not when the PC boots.
- Without it, she still runs every command that doesn't need the model: `/ping`, `/remind`,
  `/reminders`, `/tell`, `/dm` and `/echo`. Reminders still arrive.
- Chat and `/ask` answer with her offline line (*"my head's not working right now"*), and `/status`
  shows Ollama as unreachable. You get a DM from her when Ollama stops answering, and another when
  it's back (`OLLAMA_ALERTS=false` turns those off).

So, on Windows:

- **Settings → System → Power → Screen, sleep & hibernate timeouts:** set *sleep* to **Never**
  while plugged in. The screen can still turn off.
- **Settings → Accounts → Sign-in options:** turn on **Use my sign-in info to automatically finish
  setting up after an update**. This signs you back in and locks the PC after a Windows Update
  restart, so Ollama comes back.
- **Settings → Windows Update → Advanced options → Active hours:** set them to when people talk to
  her, so update restarts happen outside them.

**Gaming on the same PC.** The chat model holds about 8 GB of graphics memory while it's loaded. In
setup B, keep `OLLAMA_KEEP_ALIVE=1h` (step 6) instead of `-1`, so the memory is freed an hour after
the last message. To free it straight away, run `ollama stop qwen3:8b` before you play. The next
message loads it again, which takes about 9 seconds.

---

## 4. A user for Ghost

Ghost gets an account of her own, with no password and no login shell. If something ever goes wrong
inside the bot, it can only touch her files.

```sh
sudo adduser --system --group --home /opt/ghost ghost
```

---

## 5. The code

The rest of the setup runs as `ghost`. To open a shell as her:

```sh
sudo -u ghost -H -s
```

Then fetch the code and install what it needs:

```sh
cd /opt/ghost
git clone https://github.com/alwaysneverr/Ghost.git
cd Ghost
git checkout main
npm ci --omit=dev --omit=optional
```

`npm ci` installs exactly the library versions in `package-lock.json`, the ones the bot was
tested with. `npm install` could pick newer ones. What the options do:

- `--omit=dev` skips the lint tools.
- `--omit=optional` skips Transformers.js, a large download that only `RAG_RERANK=true` uses.
  Leave it out of the command if you've turned reranking on.

Run `main`, since `dev` is where unfinished work goes. Stay in this shell for the next step.

---

## 6. Her data and `.env`

Neither of these is in the repository, since `data/` and `.env` are git-ignored.

**On the Windows PC**, stop the bot (Ctrl+C in its window). Then, in PowerShell, copy her files to
the new machine. Replace `you@debian` with your username and the machine's name or address:

```powershell
scp D:\Ghost\Ghost\data\index.db D:\Ghost\Ghost\data\ghost.db you@debian:/tmp/
```

What the two files are:

| File | What's in it |
| --- | --- |
| `index.db` | The script scenes she searches. Without it she chats, but without the script. |
| `ghost.db` | Reminders, recent conversations and what she remembers about people. Optional: without it she starts fresh. |

`data/scripts/` is only needed to rebuild the index with `npm run index`. Copy it the same way, with
`scp -r`, if you want to be able to do that on the server.

**Back on Debian**, leave the `ghost` shell (`exit`), then move the files into place:

```sh
sudo install -d -o ghost -g ghost -m 700 /opt/ghost/Ghost/data
sudo install -o ghost -g ghost -m 600 /tmp/index.db /tmp/ghost.db /opt/ghost/Ghost/data/
rm /tmp/index.db /tmp/ghost.db
```

**Write `.env`** as `ghost`:

```sh
sudo -u ghost -H -s
cd /opt/ghost/Ghost
nano .env
```

Put this in it, using the new token:

```ini
DISCORD_TOKEN=...
CLIENT_ID=...
OLLAMA_KEEP_ALIVE=-1     # keep the models loaded until Ollama stops; this machine has nothing else to run
MESSAGE_LOG_DAYS=30      # delete message log entries after 30 days
```

`OLLAMA_KEEP_ALIVE` goes in Ghost's `.env`, not Ollama's settings, because Ghost sends it with
every request and that wins over Ollama's own setting. Any other setting in the guide's `.env`
section works here too.

**In setup B**, point her at the Windows PC, and keep the models only for an hour so the card
is free for other things (see step 3b):

```ini
OLLAMA_URL=http://192.168.1.10:11434
OLLAMA_KEEP_ALIVE=1h
```

Save with Ctrl+O, Enter, then exit with Ctrl+X. Then lock the file:

```sh
chmod 600 .env
```

**Try her once in the foreground:**

```sh
npm start
```

Watch for the `🔥` line that says the models loaded, then say something to her on Discord. If she
answers, press Ctrl+C and `exit` the `ghost` shell.

Commands are registered with Discord, not with the machine. You only need `npm run deploy` again if
they changed since you last ran it, and you can run it from either machine.

---

## 7. Start at boot, restart on crash

Create the service:

```sh
sudo systemctl edit --force --full ghost.service
```

Paste this into the empty file:

```ini
[Unit]
Description=Ghost Discord bot
Wants=network-online.target ollama.service
After=network-online.target ollama.service

[Service]
User=ghost
Group=ghost
WorkingDirectory=/opt/ghost/Ghost
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=15

# She only needs to write to data/. The rest of the system is read-only to her.
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=/opt/ghost/Ghost/data

[Install]
WantedBy=multi-user.target
```

Save it, then start it and set it to start at boot:

```sh
sudo systemctl enable --now ghost
systemctl status ghost            # should say active (running)
journalctl -u ghost -f            # her console, live; Ctrl+C stops watching, not her
```

What the setup does:

- **`WorkingDirectory` matters,** because `.env` is read from it.
- **`Restart=always`** brings her back 15 seconds after any crash.
- **`After=ollama.service`** starts her once Ollama has started. If Ollama isn't ready yet, she
  warns in the console and loads the models on the first message instead.
- **In setup B**, there's no `ollama.service` on this machine. Take `ollama.service` off the
  `Wants=` and `After=` lines. If the Windows PC is off when she starts, she warns once and carries
  on, and she loads the models with the first message once it's back.

**Now test the reason you did all this.** Run `sudo reboot`, don't log in, and message her from
Discord. She should answer within a minute of the machine starting. Then run `/status` to check
that the models show as loaded.

---

## 8. Day to day

| To… | Run |
| --- | --- |
| Watch her console | `journalctl -u ghost -f` |
| See the last hour | `journalctl -u ghost --since "1 hour ago"` |
| Restart her | `sudo systemctl restart ghost` |
| Stop her | `sudo systemctl stop ghost` (`disable` as well to keep her off after reboots) |
| Check the models are on the card | `ollama ps` |
| Check everything from Discord | `/status` |

**Updating her:**

```sh
sudo -u ghost -H -s
cd /opt/ghost/Ghost
git pull
npm ci --omit=dev --omit=optional
npm run deploy                    # only if a command was added or changed
exit
sudo systemctl restart ghost
```

To update Ollama, run its installer again. It keeps your models.

**Her console is also a log.** The journal records the first 200 characters of every message
people send her and every message she sends. It doesn't keep text she withholds, such as grief or
crisis messages. To delete it on the same schedule as `MESSAGE_LOG_DAYS`:

```sh
sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nMaxRetentionSec=30day\n' | sudo tee /etc/systemd/journald.conf.d/retention.conf
sudo systemctl restart systemd-journald
```

On Debian 12, rsyslog also copies the journal into `/var/log/syslog`, which is rotated away
after a week.

---

## 9. Backups (optional)

`ghost.db` holds reminders and what she remembers about people. A daily copy that keeps the last
14 days:

```sh
sudo install -d -o ghost -g ghost -m 700 /opt/ghost/backups
sudo systemctl edit --force --full ghost-backup.service
```

```ini
[Unit]
Description=Back up Ghost's database

[Service]
Type=oneshot
User=ghost
ExecStart=/bin/sh -c 'sqlite3 /opt/ghost/Ghost/data/ghost.db ".backup /opt/ghost/backups/ghost-$(date +%%F).db" && find /opt/ghost/backups -name "ghost-*.db" -mtime +14 -delete'
```

```sh
sudo systemctl edit --force --full ghost-backup.timer
```

```ini
[Unit]
Description=Back up Ghost's database daily

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

```sh
sudo systemctl enable --now ghost-backup.timer
sudo systemctl start ghost-backup     # make one now, to check it works
ls -l /opt/ghost/backups
```

`.backup` takes a consistent copy while she's running. Copying the file with `cp` can catch it
half-written. To restore a backup:

1. Run `sudo systemctl stop ghost`.
2. Copy the backup over `data/ghost.db`, keeping `ghost` as the owner.
3. Run `sudo systemctl start ghost`.

A backup on the same disk doesn't survive the disk failing, so copy one elsewhere now and then.

---

## 10. The machine itself

Ghost is only as up as the machine is, so a few settings matter.

**Never sleep.** Desktop installs suspend when idle:

```sh
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

**Come back after a power cut.** In the BIOS, look for *Restore on AC Power Loss* (or *After Power
Failure*) and set it to **Power On**.

**Security updates by themselves:**

```sh
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

Both services come back after a reboot by themselves. After a kernel update, though, run
`ollama ps` once. If the NVIDIA driver didn't rebuild for the new kernel, Ollama falls back to the
CPU without saying so, and replies become slow.

**SSH, if you manage the machine from another PC:**

- Use a key instead of a password (`ssh-copy-id you@debian` from the other PC).
- Then set `PasswordAuthentication no` in `/etc/ssh/sshd_config` and run
  `sudo systemctl restart ssh`.
- With a firewall, only SSH needs to be allowed in:
  ```sh
  sudo apt install ufw
  sudo ufw allow OpenSSH
  sudo ufw enable
  ```

---

## Troubleshooting

| What you see | Cause and fix |
| --- | --- |
| She answers everything twice | The Windows copy is still running. Stop it. |
| `status=200/CHDIR` | `WorkingDirectory` doesn't match where the code is. |
| `status=217/USER` | The `ghost` user doesn't exist. Do step 4. |
| She restarts every 15 seconds, with `An invalid token was provided` | `DISCORD_TOKEN` in `.env` is wrong or was reset. |
| `No such built-in module: node:sqlite` | Node is older than 22.13. Do step 2 again, and check `/usr/bin/node --version`. |
| `SQLITE_READONLY`, `EROFS` or `EACCES` under `data/` | `data/` isn't owned by `ghost`, or `ReadWritePaths` doesn't match it. Run `sudo chown -R ghost:ghost /opt/ghost/Ghost/data`. |
| `ECONNREFUSED` to `localhost:11434` | Ollama isn't running. Run `sudo systemctl status ollama`. |
| Setup B: `ECONNREFUSED`, `EHOSTUNREACH` or a timeout to `192.168.1.10:11434` | The Windows PC is off, asleep or signed out. Or its address changed, or Ollama was started before `OLLAMA_HOST` was set. Check with `curl` from step 3b. |
| Setup B: it worked, then stopped after the Windows PC moved networks | Windows set the new network to Public, and the firewall rule only applies to Private ones. Tailscale avoids this. |
| Tailscale: it worked for months, then stopped | Key expiry. Sign the machine in again (`sudo tailscale up` on Debian, or the tray menu on Windows), then disable key expiry for it in the admin console. |
| Tailscale: unreachable while someone else is signed in to the PC | **Run unattended** is off in Tailscale's Windows menu. Ollama also needs your own account signed in. |
| Tailscale: `tailscale ping` works but `curl` hangs | The firewall rule. Check that `-RemoteAddress` is the Debian machine's *Tailscale* address, from `tailscale ip -4` on Debian, not its home-network one. |
| Replies suddenly take 30 seconds after an update | The models are on the CPU. Check `ollama ps`, then `nvidia-smi`. If the driver is missing, run `sudo apt install --reinstall linux-headers-amd64 nvidia-driver` and reboot. |
| She replies without knowing the script | `data/index.db` is missing, or was built with a different embedding model. Copy it again (step 6), or copy `data/scripts/` and run `npm run index` as `ghost`. |
