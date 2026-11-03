# <p align="center"><img src="/assets/icons/ghost-256.png" width="32px" height="32px"/> Ghost</p>

A Discord Bot and nothing else. Based on a character from the visual novel 9-nine-.

## Running it

Needs Node 22.13 or newer, for its built-in SQLite. `npm start` runs the bot. After changing
any command, run `npm run deploy` so Discord knows about it.

## Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/ping`, `/hello`, `/quote` | Anyone | The usual |
| `/remind <minutes> <reason>` | Anyone | Reminds you later, in the same channel, or by DM if she can't post there |
| `/tell <message> [user]` | Anyone | She passes your message on to someone, or to everyone there. Works in group DMs. |
| `/dm <user> <message>` | Owner and team admins | She DMs someone |
| `/echo <message>` | Owner and team admins | She says something in the current channel |

- **Owner and team admins** means whoever owns the application in the Discord Developer Portal or,
  if a team owns it, the team's owner and the admins who've accepted their invite. Anyone else is
  refused, and the attempt shows in the console. Server members who aren't server admins don't see
  these commands, but people may still see them in DMs, because Discord can't hide a command there.
- **Reminders survive restarts.** They wait in `data/ghost.db` (or `GHOST_DB_PATH`) until they're
  sent. One that came due while the bot was off goes out when it starts and says how late it is.
  Up to 20 can wait per person, and there's no way to cancel one.
- **Pings:** `/tell` only pings the person it's for, and `/echo` pings nobody, even if the text
  says `@everyone`. `/tell` won't pass on a message telling someone to harm themselves.
- **Group DMs:** bots can't join them, so she's only there through people who have installed her to
  their own account, and only commands work. `/tell`, `/ping`, `/hello`, `/quote` and `/dm` work.
  `/echo` doesn't, because it posts to the channel. `/remind` is set there but arrives by DM.

## What gets logged

Every DM and @mention she gets, and everything she sends, goes to `data/logs/messages.jsonl` and
the console: 📨 for theirs, 📤 for hers. Rows say who sent it, where, and who a DM went to.
Messages in a server that don't mention her are never recorded.

**It's plain text on your machine and stays until you delete it, so tell people.** It records
everything in full, including messages from someone who's having a hard time. To follow it:
`Get-Content data\logs\messages.jsonl -Wait -Tail 20`.

Replies in group DMs, and replies only one person can see, may not all show up, because Discord
doesn't report all of them to the bot.
