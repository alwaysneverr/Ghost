# <p align="center"><img src="/assets/icons/ghost-256.png" width="32px" height="32px"/> Ghost</p>

A Discord Bot and nothing else. Based on a character from the visual novel 9-nine-.

See [GUIDE.md](GUIDE.md) for setup, forking, and training the chatbot.

## Running it

Needs Node 22.13 or newer, for its built-in SQLite. `npm start` runs the bot. After changing
any command, run `npm run deploy` so Discord knows about it. `npm test` checks the code in about
20 seconds without Ollama or Discord.

To keep her running on a Debian machine around the clock, see [HOSTING.md](HOSTING.md).

## Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/ask <message>` | Anyone | Say something to her. Works in group DMs, where she can't read the chat. |
| **Reply as Ghost** (a message's Apps menu) | Anyone | She answers that message |
| `/ping`, `/hello`, `/quote` | Anyone | The usual |
| `/remind <duration> <reason> [unit]` | Anyone | Reminds you in minutes, hours or days (up to 30), in the same channel, or by DM if she can't post there |
| `/reminders list`, `/reminders cancel` | Anyone | See or cancel your own reminders |
| `/tell <message> [user]` | Anyone | She passes your message on to someone, or to everyone there. Works in group DMs. |
| `/memory show`, `/memory forget` | Anyone | See or wipe what she remembers about you |
| `/dm <user> <message>` | Owner and team admins | She DMs someone |
| `/echo <message>` | Owner and team admins | She says something in the current channel |
| `/status [load_models]` | Owner and team admins | Whether Ollama and its models are up and loaded, and what's stored, privately |

- **Owner and team admins** means whoever owns the application in the Discord Developer Portal or,
  if a team owns it, the team's owner and the admins who've accepted their invite. Anyone else is
  refused, and the attempt shows in the console. Server members who aren't server admins don't see
  these commands, but people may still see them in DMs, because Discord can't hide a command there.
- **Reminders survive restarts.** They wait in `data/ghost.db` (or `GHOST_DB_PATH`) until they're
  sent. One that came due while the bot was off goes out when it starts and says how late it is.
  Up to 20 can wait per person.
- **Pings:** `/tell` only pings the person it's for, and `/echo` pings nobody, even if the text
  says `@everyone`. `/tell` won't pass on a message telling someone to harm themselves.
- **Group DMs:** bots can't join them, so she's only there through people who have installed her to
  their own account, and only commands work. Talk to her with `/ask`, or with **Reply as Ghost** in
  a message's Apps menu. Those, `/tell`, `/ping`, `/hello`, `/quote`, `/memory`, `/reminders`, `/dm`
  and the 👍/👎 buttons work. `/echo` doesn't, because it posts to the channel. `/remind` is set
  there but arrives by DM.
- **Ratings:** press 👍 or 👎 under any reply. Your latest press counts, and only you see her answer.

## What gets logged

Every DM and @mention she gets, and everything she sends, goes to `data/logs/messages.jsonl` and
the console: 📨 for theirs, 📤 for hers. Rows say who sent it, where, and who a DM went to.
Messages in a server that don't mention her are never recorded.

**It's plain text on your machine and stays until you delete it, so tell people.** Set
`MESSAGE_LOG_DAYS=30` in `.env` to have entries older than 30 days deleted automatically. Messages from
someone grieving or in crisis, and her replies to them, are recorded without their words. To follow
it: `Get-Content data\logs\messages.jsonl -Wait -Tail 20`. GUIDE.md has the details.

Replies in group DMs, and replies only one person can see, may not all show up, because Discord
doesn't report all of them to the bot.
