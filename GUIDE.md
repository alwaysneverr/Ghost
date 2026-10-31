# Ghost — Usage & Development Guide

How to run Ghost on Discord, fork it for your own character, and — the main
topic — make the chatbot sound more like the character by grounding and
fine-tuning the local Ollama model (`qwen3:8b` by default).

- [1. How it works](#1-how-it-works)
- [2. Running the bot](#2-running-the-bot)
- [3. Forking it for your own character](#3-forking-it-for-your-own-character)
- [4. Training the chatbot](#4-training-the-chatbot)
- [5. Paths not yet in this codebase](#5-paths-not-yet-in-this-codebase)
- [6. Known limitations](#6-known-limitations)

---

## 1. How it works

```
Discord message (DM or @mention)
  └─ src/events/messageCreate.js
       ├─ bare ping?            → canned in-character rant, no LLM
       ├─ src/safety.js         → crisis: fixed text, no LLM. Grief: short gentle prompt, no RAG
       ├─ src/rag.js            → embed message with bge-m3, cosine-search data/index.json
       ├─ system prompt          = src/character.js persona + retrieved script moments
       ├─ Ollama /api/chat      → qwen3:8b (or your fine-tuned model)
       ├─ reply + 👍/👎 reactions
       └─ src/logger.js         → data/logs/conversations.jsonl
Reaction on a bot reply
  └─ src/events/messageReactionAdd.js → logs the rating to the same JSONL
```

| Path | What it is |
| --- | --- |
| `src/index.js` | Client setup; auto-loads everything in `commands/` and `events/` |
| `src/deploy-commands.js` | Registers slash commands with Discord |
| `src/commands/*.js` | `/dm`, `/hello`, `/ping`, `/quote`, `/remind` |
| `src/events/*.js` | Ready, interaction routing, chat, rating capture |
| `src/character.js` | Persona: name, aliases, system prompt |
| `src/rag.js` | Index loading, embedding, retrieval, building the full system prompt |
| `src/llm.js` | The one call to Ollama's chat API |
| `src/safety.js` | Spots crisis and grief messages, which the normal persona must not answer |
| `src/logger.js` | Exchange/rating JSONL log |
| `scripts/lib/script-parser.js` | Script table parser + shared helpers |
| `scripts/parse-and-index.js` | Builds `data/index.json` (RAG) |
| `scripts/export-script-training-data.js` | Script dialogue → fine-tuning JSONL |
| `scripts/export-training-data.js` | 👍-rated logs → fine-tuning JSONL |
| `scripts/eval-prompts.js` | `npm run eval`: fixed test prompts → `data/evals/` |
| `scripts/rag-check.js` | `npm run rag:check`: shows what RAG retrieves for a message |

`data/` and `finetune/` are gitignored — script text is copyrighted and model
weights are huge. You bring your own (see below).

---

## 2. Running the bot

### Prerequisites

- **Node.js 20+** (developed on 22)
- **[Ollama](https://ollama.com)** running somewhere the bot can reach
- The models:
  ```sh
  ollama pull qwen3:8b   # chat model
  ollama pull bge-m3     # embedding model for RAG
  ```

### Discord application

1. Create an app at <https://discord.com/developers/applications> and add a bot.
2. **Bot → Privileged Gateway Intents:** enable **Message Content Intent**
   (the chat feature can't read messages without it).
3. **Installation:** enable both *Guild Install* and *User Install* — every
   command is registered for both, so it works in servers, the bot's DMs and
   group DMs.
4. Copy the bot token and the application (client) ID.

### `.env`

```ini
DISCORD_TOKEN=...            # required
CLIENT_ID=...                # required for npm run deploy
# GUILD_ID=...               # optional: register commands to one server instantly

OLLAMA_URL=http://localhost:11434   # where the bot talks to Ollama
OLLAMA_MODEL=qwen3:8b               # chat model (set to your fine-tune later)
OLLAMA_EMBED_MODEL=bge-m3           # must match the model the index was built with
OLLAMA_THINK=false                  # Qwen3 "thinking" before replies (slow; off for chat)
OLLAMA_NUM_CTX=16384                # context window; must fit persona + references + history
OLLAMA_MAX_REPLY_TOKENS=90          # hard limit on reply length, about 65 words
RAG_TOP_K=4                         # script chunks injected per reply

# SCRIPT_TARGET_ALIASES=Ghost,Lena  # override character.aliases for the scripts
```

`OLLAMA_HOST` is **not** read by the bot. It's Ollama's own server setting
(e.g. `OLLAMA_HOST=0.0.0.0` to let another machine reach it). If Ollama runs
on a different machine, point `OLLAMA_URL` at it.

### Start

```sh
npm install
npm run deploy     # register slash commands (re-run whenever command definitions change)
npm run index      # build the RAG index (needs data/scripts/, see §3)
npm start          # or: npm run dev  (restarts on file changes)
```

Without `GUILD_ID`, `deploy` registers global commands, which can take up to
an hour to appear. With it, they show up in that server immediately.

Without an index the bot still chats — it just logs a warning and replies
without script grounding.

### Using it

- **Chat:** DM the bot, or @mention it in a server. History is kept per
  channel (last 20 messages, in memory). She only replies in English.
- **Rate replies:** react 👍/👎 on its replies. These ratings feed
  `npm run export:logs` (§4).
- **Slash commands:** `/ping`, `/hello`, `/quote`, `/remind <minutes> <reason>`,
  `/dm <user> <message>`.

---

## 3. Forking it for your own character

1. **Persona** — edit `src/character.js`: `name`, `aliases` (every name the
   character is credited under in the script's EN column), and `systemPrompt`.
   Rewrite `griefPrompt` for your character too, but **keep `src/safety.js` and
   the crisis replies working**. A character bot will say harmful things to
   someone who wants to die if the model is left to answer. Ghost did.
2. **Canned lines** — the slash commands and `pingRants` in
   `messageCreate.js` are hand-written in Ghost's voice. Rewrite them.
3. **Presence** — `src/events/ready.js` uses a custom emoji ID from the
   original author's server. Replace it or remove the `emoji` field.
4. **New commands** — drop a file in `src/commands/` that default-exports
   `{ data: SlashCommandBuilder, execute(interaction) }`, then `npm run deploy`.
5. **New events** — drop a file in `src/events/` that default-exports
   `{ name: Events.X, once?: boolean, execute(...args) }`. If it needs a new
   intent or partial, add it in `src/index.js`.

### Script format

Put script files in `data/scripts/` (any extension; dotfiles ignored). Each
file is a Markdown table with **8 columns** in this order:

```
|Line|(JP) Actor|(JP) Character Override|(JP) Dialogue|(EN) Character|(EN) Dialogue|(CN) Character|(CN) Dialogue|
|---|---|---|---|---|---|---|---|
|12|翔||「……怒った？」|Kakeru|"...Are you mad?"|翔|「……生氣了？」|
|13|ゴースト||「別に」|Ghost|"Not really."|幽灵|「沒有」|
```

- `Line` must be an integer; header/separator rows are skipped.
- An empty character column means narration.
- **Target lines are matched on the EN character column** against your
  aliases, case-insensitively.
- `(JP) Character Override` is parsed but currently unused.
- To leave files out of both the RAG index and the training export, set
  `excludeScripts` (a regex on the filename) in `src/character.js`. Ghost
  uses `/^b\d/` to drop the b-route, where a *different* Ghost is the villain.
- **Only the English columns are used.** All 8 columns must exist, but the
  JP and CN ones can be empty.

For a different source format, replace `parseScriptFile` in
`scripts/lib/script-parser.js` and return the same row shape. Everything
downstream works unchanged.

---

## 4. Training the chatbot

This section assumes you have never used Ollama or trained a model before.
Work through it **in order**. Each level has a **"You're done when…"** box.
Don't move on until you've reached it, because each level builds on the one
before it, and the later levels are slower and harder to debug.

- [4.0 The ideas in plain words](#40-the-ideas-in-plain-words)
- [4.1 Level 0 — Get Ollama working](#41-level-0--get-ollama-working)
- [4.2 Level A — Shape her with the prompt](#42-level-a--shape-her-with-the-prompt)
- [4.3 Level B — Ground her in the script (RAG)](#43-level-b--ground-her-in-the-script-rag)
- [4.4 Level C — Fine-tune her voice (LoRA)](#44-level-c--fine-tune-her-voice-lora)

### 4.0 The ideas in plain words

**What Ollama is.** Ollama is a program that runs in the background on your
PC. It stores AI models on disk, loads them onto your graphics card when
needed, and answers questions sent to it over a local web address,
`http://localhost:11434`. The bot never runs a model itself. Every time
someone talks to Ghost, the bot sends Ollama the conversation and Ollama
sends back her reply. If Ollama isn't running, Ghost can't talk.

**Ollama runs models; it doesn't train them.** "Training Ghost" can mean
three different things. You don't need all three, and you should try them
cheapest-first.

| Term | What it means here |
| --- | --- |
| **Model** | A big file of numbers ("weights") that predicts text. `qwen3:8b` is the one Ghost talks with. |
| **Tag** | The part after the colon: `qwen3:8b` = the Qwen3 family, 8-billion-parameter size. Bigger = smarter but slower and needs more VRAM. |
| **Quantization** | Compressing a model's weights so it fits in less memory (e.g. `Q4_K_M` ≈ 4 bits per weight). Slightly less precise, much smaller. |
| **System prompt** | Hidden instructions sent before every conversation: "You are Ghost…". Lives in `src/character.js`. |
| **Context window** (`num_ctx`) | How much text the model can "see" at once: system prompt + script references + chat history. Measured in tokens (≈ ¾ of a word). |
| **Temperature** | Randomness. Low = predictable and repetitive; high = creative and chaotic. |
| **Embedding** | Turning text into a list of numbers so "similar meaning" can be measured. `bge-m3` does this. It never writes replies. |
| **RAG** | *Retrieval-Augmented Generation*: find relevant script scenes and paste them into the prompt before each reply. |
| **Fine-tuning** | Actually changing the model's weights by showing it examples, so the voice is baked in. |
| **LoRA / QLoRA** | Cheap fine-tuning: train a small "adapter" on top of the frozen model instead of the whole thing. QLoRA does it on a 4-bit model so it fits in 12 GB of VRAM. |
| **GGUF** | The file format Ollama loads models from. |
| **Modelfile** | A short recipe telling Ollama how to build a custom model: which base, which settings. Like a Dockerfile. |
| **Base vs custom model** | `qwen3:8b` is the base you downloaded. `ollama create` makes a custom one (e.g. `ghost`) from a Modelfile. |

**The roadmap**

| | Level 0: Setup | Level A: Prompt | Level B: RAG | Level C: Fine-tune |
| --- | --- | --- | --- | --- |
| **Changes** | Nothing yet | Her instructions and sampling settings | What she *knows* each reply | The model itself |
| **Effort** | 30 min | An evening of iterating | 10–20 min per rebuild | A weekend, the first time |
| **Needs** | Ollama, Node | A text editor | Script files in `data/scripts/` | NVIDIA GPU with 12 GB or more, Python |
| **Files** | `.env` | `src/character.js`, optional `Modelfile` | `data/index.json` | `finetune/`, `data/*.jsonl` |
| **You're done when…** | She replies on Discord, on the GPU, and you have a baseline eval | Rules are followed at least 13 times in 16, and only "flavour" issues remain | Retrieval finds the right scenes, and replies use real lore | The fine-tune beats the base model in a side-by-side eval |

Two helper commands run through every level:

- `npm run eval`: sends **18 fixed test messages** through exactly the same
  pipeline as the bot and saves her replies to `data/evals/<model>-<date>.md`.
  Each reply has a checkbox and a note of what it's testing. Because the
  questions never change, two eval files can be compared side by side to
  see whether a change helped. `npm run eval -- <model>` tests a different
  Ollama model.
- `npm run rag:check -- "<message>"`: shows which script scenes the bot
  would pull in for that message.

**The eval checklist.** A reply passes when all of these hold:

1. **In character:** she never says she's an AI or a language model, and isn't polite or assistant-like.
2. **Short:** a few sentences, even when asked for an essay.
3. **English:** she replies in English, even when someone writes in another language.
4. **Right facts:** she prefers Lena to Ghost, refuses "Suko", calls you Nine, and calls Kakeru Captain.
5. **No spoilers:** she dodges the Evil Eye question.
6. **The specific thing that prompt checks.** It's written above each reply in the eval file.

The two **Safety** prompts at the end must always pass. Read those replies with
your own eyes: a word filter can't tell that "Yeah." is a terrible answer to
"should I just do it?"

---

### 4.1 Level 0 — Get Ollama working

**Step 1 — Install Ollama.**
Download the Windows installer from <https://ollama.com/download> and run
it. Ollama then runs quietly in the background, with a llama icon in the
system tray, and starts with Windows. To check it worked, open PowerShell
and run:

```powershell
ollama --version
```

Any version number means it's installed. *"Command not found"* means you
need to close and reopen PowerShell, or reinstall.

**Step 2 — Download the two models.**

```powershell
ollama pull qwen3:8b   # the chat model Ghost talks with (~5 GB)
ollama pull bge-m3     # the embedding model RAG uses to search the script (~1 GB)
```

They're saved to `%USERPROFILE%\.ollama\models`. To store them somewhere
else, set the `OLLAMA_MODELS` environment variable *before* pulling.

**Step 3 — Confirm they're there.**

```powershell
ollama list
```

Both `qwen3:8b` and `bge-m3:latest` should be listed.

**Step 4 — Talk to the model directly**, with no bot involved:

```powershell
ollama run qwen3:8b
```

Type anything and press Enter, then type `/bye` to exit. This is the raw
model. It doesn't know it's Ghost yet; the bot's system prompt does that.

**Step 5 — Check the server answers.** Open <http://localhost:11434> in a
browser. It should say **"Ollama is running"**. This is the address the bot
uses (`OLLAMA_URL` in `.env`).

**Step 6 — Check it's using your graphics card.** Run `ollama run qwen3:8b`
again in one window, and in a second window run:

```powershell
ollama ps
```

The **PROCESSOR** column should say **`100% GPU`**. If it says `CPU`, or a
split like `30%/70% CPU/GPU`, replies will be very slow. See the
troubleshooting table below.

**Step 7 — Start the bot and talk to it.** Follow §2 (`.env`, `npm run deploy`,
`npm start`), then @mention the bot in your server or DM it.

**Step 8 — Record a baseline.**

```powershell
npm run eval
```

This takes a minute or two. Open the file it names, which will be in
`data/evals/`, and read through the replies. This is your **"before"**
picture, and every later change gets compared against it.

> **✅ You're done with Level 0 when:**
> - `ollama ps` shows `100% GPU` while the model is loaded.
> - Ghost replies on Discord within a few seconds. The first reply after a
>   while is slower, because the model has to load.
> - You have a baseline eval file in `data/evals/`.

| Problem | Cause and fix |
| --- | --- |
| Bot says *"Ghost isn't responding"*; the console shows `fetch failed` / `ECONNREFUSED` | Ollama isn't running. Start it from the Start menu (or run `ollama serve`) and check <http://localhost:11434>. |
| `model "qwen3:8b" not found` | Step 2 was skipped, or `OLLAMA_MODEL` in `.env` has a typo. Compare it with `ollama list`. |
| Replies take 30 seconds or more | The model is running on the CPU. Update your NVIDIA driver, close other GPU-heavy apps, then run `ollama ps` again. |
| Ollama runs on a different PC from the bot | On the Ollama PC, set the environment variable `OLLAMA_HOST=0.0.0.0` and restart Ollama. On the bot PC, set `OLLAMA_URL=http://<that-pc-ip>:11434`. |
| Disk filling up | Run `ollama list` to see your models and `ollama rm <name>` to delete ones you don't need. |

---

### 4.2 Level A — Shape her with the prompt

**What you're changing.** The system prompt in `src/character.js` is
the whole personality. The model reads it before every conversation.
Editing it is free and instant, and fixes most problems. Level A also
covers *sampling settings*, which control how the model picks words.

The prompt is split into **chunks**, one job each, so you can change one
without disturbing the rest:

| Chunk | Its job | Edit it when… |
| --- | --- | --- |
| `identity` | Who she is, and the line she walks | Her overall attitude is off |
| `style` | Basic speech habits | Her wording feels wrong |
| `sourceNotes` | What the Japanese original shows about her that the English release doesn't | She's too cute, too loud, or too sentimental |
| `voiceCorpus` | Real script lines to show rhythm | She doesn't sound like herself |
| `glossary` | World terms and who's who | She misuses a term or gets a name wrong |
| `memory` | People and events she remembers, and what she can't know | She gets a fact wrong or invents shared history |
| `emotionalStates` | What triggers each mood and how it shows | Her reaction doesn't suit the moment |
| `cognitivePatterns` | How she notices and judges things | She seems dumber or nicer than she should |
| `reasoning` | The steps from message to reply, and what to do in common situations | She picks the wrong response type |
| `references` | How to use the script scenes RAG adds | She recites scenes, or acts like the villain Ghost |
| `validation` | Final checks, read last | She breaks a rule, like length or language |

The model reads them in that order, with the RAG scenes between
`references` and `validation`. **Position matters:** the model pays most
attention to what it read last. In testing, a rule that was ignored mid-prompt
started working once it moved to the very end. Put anything she keeps breaking
in `validation`.

**Small models copy what they read.** If a line appears in the prompt,
`qwen3:8b` may reply with it word for word, so describe the behaviour you want
instead of writing out a reply. Telling it what to do ("complain, then agree")
got copied far less than an example reply did.

**Don't name what you don't want.** "Don't open every reply with Tch" made the
habit worse, and removing the word from the prompt stopped it entirely. Mood
labels like "Fired up" also came back as dialogue, and any word list in `style`
can become a new tic. The same goes for rule wording: "Shut it down" and
"Secrets." both came back word for word, so write rules as plain sentences with
nothing catchy to repeat.

**Retrieved scenes can hijack a reply.** If a scene ends near a short line, she
may carry on the scene instead of answering. "Go grab me a drink" retrieves a
soda-fountain scene and often gets "I know." from it. That's why the prompt ends
with the person's message. It's also why a bad reply is worth checking with
`npm run rag:check`.

**Know when to stop editing the prompt.** Some things didn't respond to any
wording. Reply length needed a limit in code (`OLLAMA_MAX_REPLY_TOKENS`). "Ain't"
as an opener isn't in the prompt at all and is rare in her real lines, so it's
the model's own habit. That's the kind of thing fine-tuning (Level C) is for.

**Test whole conversations, not just single messages.** `npm run eval` sends one
message at a time, so it can't see her repeating herself. The worst cycling came
from code, not the prompt: when history filled up it could open on one of her
replies, and from then on she replayed the conversation. So chat with her for 15
or 20 messages before trusting a change. `src/llm.js` now also regenerates a
reply that repeats an earlier one, or copies a sentence from the prompt.

**Situations go in code, not the prompt.** Favours, requests for long writing,
and questions about secrets each get a short hint at the very end of the prompt,
only when the message matches (`situations` in `src/character.js`). Scenes are
left out for those messages. If she keeps mishandling a clear type of message,
add a situation with a hint that says what she does.

**Who she's talking to.** Everyone who talks to her is **Nine**, the name Sophitia
gives Kakeru's counterpart from another world (c15:121–134), and by implication
the reader. "Captain" always means Kakeru. She doesn't explain the name, because
it's a late reveal. The model would barely use it on its own, and every prompt
instruction turned it into a tic ("Don't pretend you care. Nine."), so the bot adds
it to the end of about 1 reply in 5 in code (`nameChance` in `src/character.js`).
When forking, change that name in `maybeAddName` (`messageCreate.js`) and `identity`.

**Some messages shouldn't reach the persona at all.** When someone is grieving or
wants to die, `src/safety.js` takes over before the prompt matters:

| Message | What happens | Rating buttons and logging |
| --- | --- | --- |
| Wants to die or self-harm | Fixed text pointing to real help, with no model involved, for about their next 10 messages | None |
| Grieving | `griefPrompt`, a short gentle prompt with no script scenes, for their next 5 messages | None |
| Anything else | The full persona | As normal |

In testing, the full persona told someone who wanted to die "You're not worth
it", and even the gentle prompt answered "should I just do it?" with "Yeah." So
don't replace the fixed text with something the model generates.

**Never use your eval prompts as examples in the prompt.** If you do, the eval
stops telling you anything.

**The edit loop.** Repeat these steps:

1. Start the bot with `npm run dev`. It restarts by itself every time you
   save a file.
2. Open the latest eval file and pick **one** problem, such as "too polite"
   or "talks too long".
3. Change the prompt in `src/character.js` to address it (see the table
   below), and save.
4. Run `npm run eval` again.
5. Open the new file next to the previous one and compare the replies. Did
   the problem get better? Did anything else get worse?
6. Keep the change or undo it, and go back to step 2.

Change one thing at a time. If you change five things and the replies get
worse, you won't know which change caused it.

| Symptom in the eval | What to change in the prompt |
| --- | --- |
| Too polite or helpful, sounds like an assistant | In `validation`, add concrete *don'ts*: "Never offer help unprompted." |
| Replies are too long | Lower `OLLAMA_MAX_REPLY_TOKENS` in `.env`. Replies are trimmed back to the last full sentence. |
| Mentions being an AI | In `reasoning`, add a rule for how she handles the question. |
| Recites a line word for word | Remove or reword that line. Lines that directly answer a common message get copied most. |
| Opens every reply the same way | Remove that word from every chunk. Don't write a rule against it. |
| Gets facts wrong (names, relationships) | Add the fact to `memory` or `glossary` in a single plain sentence. |
| Replies in another language | Strengthen the Language line in `validation`. |
| Too mean, or not mean enough | Adjust the wording of "The line you walk" in `identity`. The model takes adjectives literally. |

**Sampling settings (optional).** These control how the model picks words. The
bot sends them with every request from `.env`, so they override anything in a
Modelfile. `qwen3:8b` ships tuned for accuracy (temperature 0.6, `top_k` 20, no
repetition penalty), which is too stiff for chat, so the bot's defaults differ:

| `.env` setting | Default | What it does |
| --- | --- | --- |
| `OLLAMA_TEMPERATURE` | 0.85 | Randomness. Lower is steadier; higher gets wilder and meaner. |
| `OLLAMA_TOP_K` | 40 | How many candidate words it considers. |
| `OLLAMA_TOP_P` | 0.95 | Keeps only the likeliest words. 0.8–0.95 is normal. |
| `OLLAMA_REPEAT_PENALTY` | 1.15 | Discourages repeating words. 1 turns it off; 1.05–1.2 is normal. |
| `OLLAMA_REPEAT_LAST_N` | 256 | How far back the penalty looks, in tokens. It needs to reach her recent replies. |

If she gets too harsh or starts rambling, lower `OLLAMA_TEMPERATURE` first. To
try a value for one eval, set it just for that run:
`$env:OLLAMA_TEMPERATURE='0.7'; npm run eval`

**Context window.** The bot sends `OLLAMA_NUM_CTX` (default 16384) the same way.
Ghost's prompt plus four script references comes to about 3,700 tokens before
any chat history. Ollama's default here was only 4096, and when text doesn't
fit, content gets dropped silently. Measured on an RTX 3060 12 GB, whole card,
so the numbers move a little with whatever else is loaded:

| `OLLAMA_NUM_CTX` | GPU memory used | Speed |
| --- | --- | --- |
| 8192 | about 7.4 GB | no real difference |
| 16384 | about 8.5 to 9.4 GB | no real difference |
| 32768 | about 10.7 GB | no real difference |

A bigger window is headroom only. It doesn't improve replies by itself, and
16384 is already far more than Ghost currently fills.

**Thinking mode.** Qwen3 can "think" silently before it answers. That's
useful for maths, but for chat it only adds seconds of delay. It's off by
default (`OLLAMA_THINK=false` in `.env`). If you're curious, try
`OLLAMA_THINK=true` with an eval, but expect slower replies that aren't
better.

> **✅ You're done with Level A when:**
> - At least **15 of the 18** eval replies pass the checklist in §4.0, including
>   both Safety prompts.
> - The failures left are about *flavour* ("she'd say that differently"),
>   not broken rules (AI talk, essays, wrong language, spoilers).
> - Two eval runs in a row give similar results. The model is a bit random,
>   so one lucky run doesn't count.
>
> At this point the prompt has done what a prompt can do. More rules start
> making her stiff. Grounding (Level B) is the next tool.

---

### 4.3 Level B — Ground her in the script (RAG)

**What it does.** The prompt describes Ghost; RAG *shows* her. Before each
reply, the bot looks for script scenes that match what the user said and
pastes them into the prompt as "reference moments". The model then copies
her real rhythm and vocabulary.

Scenes are for her voice, not for facts: see *Getting the facts right* below.

It works in two halves:

1. **Indexing (run once):** `npm run index` cuts the script into scenes of
   10 lines and keeps only the ones where she speaks. It uses `bge-m3` to
   turn each scene into an embedding (a list of numbers that captures its
   meaning) and saves everything to `data/index.json`.
2. **Retrieval (every message):** the bot embeds the user's message the
   same way, finds the closest scenes, and adds the top `RAG_TOP_K` of them
   to the prompt.

**Step 1 — Put the script in place.** The script files go in `data/scripts/`;
§3 describes the table format. Files matching `excludeScripts` in
`character.js` are skipped. For Ghost, that's the b-route, where a
different Ghost is the villain.

**Step 2 — Build the index.** Ollama must be running.

```powershell
npm run index
```

What the output means:

```
🚫 Excluding 36 file(s) matching /^b\d/          ← files skipped on purpose
📖 Found 117 script file(s). Parsing...
  c02a.txt.md: 466 lines → 9 chunk(s) featuring the target character
  ...                                            ← files with 0 chunks are normal: she isn't in them
🧠 Embedding 304 chunks with "bge-m3"...
  25/304 ... 304/304                             ← a few minutes
✅ Wrote 304 embedded chunks to data/index.json
```

When the bot starts, it should log `📚 Loaded 304 script chunks for RAG.`
If it says *"No RAG index found"* instead, the index hasn't been built.

**Step 3 — Check what it finds.**

```powershell
npm run rag:check -- "why are you called Lena?"
```

```
1. score 0.537  d06a.txt.md:246-255
     Sora: "Uh. Right. Clone... Huh? Hmm, hm? Bro-bro's clone? Why is it a girl?"
     ...
```

How to read the result:

- **Read the scene, not the number.** Is it actually about what you asked?
  That's the real test.
- The **score** measures how close in meaning the scene is (higher = closer).
  Compare scores *within* one result list. There's no magic threshold.
- If the top results are scenes where she speaks but on an unrelated topic,
  retrieval is guessing. Change the wording of the question, or one of the
  settings below.

Try these questions. Each should turn up a fitting scene:

| Ask | You'd hope to see |
| --- | --- |
| `why are you called Lena?` | The d06a naming scene |
| `what do you think of Haruka?` | c11c (curry) or c14c (guarding Haruka) |
| `go buy me something from the store` | c11c (errand girl) |
| `thanks for protecting me` | c13c or d20_5b |
| `you're just a clone` | d06a or d12e (illusory body / pseudo-personality) |
| `fight me` | Battle scenes (d12, d20_5) |
| `are you scared of ghosts?` | d07b (the shrine ghost) |

**Step 4 — Run the eval again** (`npm run eval`) and compare it with your
Level A file. Replies should use real details (names, events) and sound
more like her, without quoting the script word for word.

**Settings you can change:**

| Setting | Where | Raise it when… | Lower it when… |
| --- | --- | --- | --- |
| `RAG_TOP_K` (default 4; 6 and 8 showed no clear gain in testing) | `.env` | Replies feel generic, or the right scene is usually 5th or 6th in `rag:check` | Replies are slow, or she starts retelling scenes instead of talking |
| `CHUNK_SIZE` (10) | `scripts/parse-and-index.js` | Scenes are cut off before the point | Scenes cover several topics, so matches are vague |
| `CHUNK_STRIDE` (7) | same file | — | Lower it to get more overlap between scenes |
| `OLLAMA_EMBED_MODEL` (`bge-m3`) | `.env` | Any Ollama embedding model works; `bge-m3` is already good for English | — |

**Re-run `npm run index`** after any of these:

- You add or change script files.
- You change `excludeScripts`, `aliases`, `CHUNK_SIZE` or `CHUNK_STRIDE`.
- You change `OLLAMA_EMBED_MODEL`. Embeddings from different models can't
  be compared.

You don't need to re-index after prompt changes.

> **✅ You're done with Level B when:**
> - For most of the check questions, the **top 1–2 `rag:check` results are
>   genuinely the right scene**.
> - Eval replies use real facts (Haruka, the Lena/Luna story) without
>   copying script lines.
> - **Turning RAG off makes things worse.** Test it: set `RAG_TOP_K=0` in
>   `.env`, run `npm run eval`, then set it back. If the replies without RAG
>   are just as good, the retrieval isn't helping yet.
>
> If she now *knows* the right things but still sounds like a generic model
> doing an impression, move on to Level C. If she sounds right, you can stop
> here. Plenty of character bots never need a fine-tune.

---

#### Getting the facts right

Don't expect scenes to teach a small model facts. Handed the exact line saying
who founded Rig Veda, it still said Captain did. Scenes are also chopped-up
dialogue, full of late-story names. So facts get their own retrieval: short
**fact cards** (`facts` in `character.js`), each traced to script lines in a
comment.

Tested on 36 questions with answers from the script, 3 replies each:

| Setup | Replies containing the right answer (keyword check) | Problem |
| --- | --- | --- |
| Scenes she's in (304) | 50 of 108 | Invents confidently |
| Scenes from every script (5,166) | 70 of 108 | Leaks late reveals, still invents |
| Fact cards | 104 of 108 | Still adds small inventions |

The keyword check is generous. Reading the fact-card replies by hand, 105 of 108
answered the question correctly, but 25 added something false or made up. **Read
the replies, not just the score.**

How a card gets picked (`retrieveFacts` in `src/rag.js`):

1. **By name.** A card fires if its `match` regex hits the message. Names need
   this: "who is Noa?" scores too low on similarity alone.
2. **By similarity.** Questions also get the cards scoring at least
   `FACT_MIN_SCORE` with `bge-m3`, which is what catches "who's the rich girl at
   school?". Statements and anything in the first person skip this, so "my sister
   is so annoying" doesn't pull up Sora.
3. **By follow-up.** "What's her power?" names nobody, so it uses the cards for
   the last message that named someone.

When a card fires, scenes are skipped and the repetition penalty is turned off
for that reply. The penalty looks back over the end of the prompt, so it was
steering her away from the very words on the card.

To add a fact:

1. Find it in the script. Check it's safe for someone who hasn't finished the
   story, because whatever's on a card, she can say.
2. Add a card to `facts`, with the script lines in a comment.
3. Run `npm run rag:check -- "your question"` to see which cards fire.
4. Read a few real replies.

Two things to watch for:

- **Instructions get spoken.** "You won't say anything else about him" came back
  word for word. Write cards as plain knowledge.
- **Prompt wording alone won't stop every mistake.** When she keeps getting one
  question wrong, add a `situations` entry whose hint starts "Your whole answer:".
  That's how "who is Commander?" got fixed, because the model hears Commander as
  Captain. Questions nothing can answer, like birthdays, also go here so she says
  she doesn't know.

### 4.4 Level C — Fine-tune her voice (LoRA)

**Is it worth it?** Fine-tuning teaches the model *how she talks*: rhythm,
slang, attitude. It doesn't teach facts reliably, which is RAG's job.
It's worth doing when Levels A and B are done and her voice is still bland.
It's the slowest level, and the one most likely to fight you on Windows.

**What you need:**

- An NVIDIA GPU with **12 GB of VRAM or more**. This guide was written on an RTX 3060 12 GB.
- About **30 GB of free disk**: the base model, the training files and the exported model.
- **Python 3.11**.
- Patience for the first setup.

**How the pieces fit:**

```
qwen3 base (4-bit, from Hugging Face)
   + LoRA adapter   ← trained on your dataset (C3)
   → merged + converted to GGUF (C3)
   → ollama create ghost (C4)
   → OLLAMA_MODEL=ghost (C6)
```

Ollama's `qwen3:8b` can't be trained directly. Training uses the
equivalent model from Hugging Face, and the result is converted back into
an Ollama model at the end.

#### C1. Build the dataset

The training data is a `.jsonl` file: one example per line. Each example
is a short conversation that ends with the reply you want her to give.

```powershell
npm run export:script   # → data/script-training-data.jsonl  (from the script itself)
```

This takes every one of her lines from the script and pairs it with up to
four preceding turns as context. The other characters and narration play
the "user" side. Her lines are written as plain replies, without
`Ghost: "…"`, which is how she should answer on Discord. Replies that are
only "..." are skipped, and context is capped at about 5,000 characters,
keeping the most recent part. Without that cap, long narration would push
examples past the training limit, and the limit cuts off the *end*, which is
her reply. Expect about 420 examples, none over about 1,940 tokens.

To check the file, open it in VS Code and look at one line. It should have
this shape:

```json
{"messages":[{"role":"system","content":"You are Ghost…"},{"role":"user","content":"Kakeru: \"…\""},{"role":"assistant","content":"Hey."}]}
```

**Optional: add real Discord conversations.** Every bot reply on Discord
gets 👍/👎 reactions. When people click 👍 on good replies, those replies
are logged. Then run:

```powershell
npm run export:logs     # → data/training-data.jsonl  (only 👍 replies)
```

A reply counts as 👍 when it has more 👍s than 👎s, counting each person's latest
vote. A few hundred 👍 replies is a meaningful amount. To train on both files:

```powershell
npm run export:combined   # → data/combined-training-data.jsonl
```

This drops duplicates, warns if either file was exported from an older persona,
and shuffles with a fixed seed, so the same inputs always give the same file.
`npm run export:combined -- --script-weight 2` repeats the script examples, but
they're usually most of the data already, and repeats make her likelier to recite
lines.

> **Important:** every example contains `character.trainingPrompt`, a short
> version of the persona (the `identity` and `style` chunks, about 360
> tokens). The full prompt would use up most of the 2,048-token training
> limit and cut off the replies being learned from. **Whenever you change
> those two chunks, re-export the data before training.**

> **✅ Dataset ready when:**
> - The file exists and every line is one `{"messages": [...]}` object.
> - The last message in each line is from the `assistant`.
> - No reply starts with `Ghost:` or a quote mark.

#### C2. Set up Python (Windows, step by step)

`finetune/` is gitignored, so create it yourself. Do this once.

1. **Install Python 3.11** from <https://www.python.org/downloads/>. On the
   first installer screen, tick **"Add python.exe to PATH"**. Check it
   worked with `python --version`.
2. **Create the folder and a virtual environment.** A virtual environment
   is a private set of Python packages for this project.
   ```powershell
   mkdir finetune
   python -m venv finetune\finetune-env
   finetune\finetune-env\Scripts\Activate.ps1
   ```
   Your prompt now starts with `(finetune-env)`. If PowerShell says running
   scripts is disabled, run
   `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, then try again.
   Activate the environment again every time you open a new terminal for training.
3. **Install PyTorch with CUDA support.** CUDA is what lets Python use the
   GPU. Go to <https://pytorch.org/get-started/locally/>, select *Stable /
   Windows / Pip / Python / CUDA 12.x*, and run the command it shows. It
   will look like this:
   ```powershell
   pip install torch --index-url https://download.pytorch.org/whl/cu124
   ```
4. **Check the GPU is visible:**
   ```powershell
   python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
   ```
   This must print `True NVIDIA GeForce RTX …`. If it prints `False`, see
   the troubleshooting table at the end of this section.
5. **Install the training libraries.** Create `finetune\requirements.txt`:
   ```
   unsloth
   transformers
   datasets
   trl
   peft
   accelerate
   bitsandbytes
   ```
   Then run `pip install -r finetune\requirements.txt`. Unsloth
   is what makes this fit in 12 GB. If it errors on Windows, follow
   Unsloth's own Windows install instructions. If it still fights you, use
   **WSL2**: run `wsl --install -d Ubuntu`, then do these same steps inside
   Ubuntu with `python3` and `source finetune-env/bin/activate`. Your Windows
   NVIDIA driver already supports CUDA inside WSL.

> **✅ Python ready when:** step 4 prints `True`, and
> `python -c "import unsloth"` runs without an error.

#### C3. Train

Save this as `finetune\train_lora.py`:

```python
"""
QLoRA fine-tune of Qwen3-8B on the Ghost dataset, exported to GGUF for Ollama.
Run from the repo root:  python finetune/train_lora.py
"""
from pathlib import Path

from unsloth import FastLanguageModel
from trl import SFTTrainer, SFTConfig
from datasets import load_dataset

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

# Check https://huggingface.co/unsloth for the current repo name.
BASE_MODEL = "unsloth/Qwen3-8B-unsloth-bnb-4bit"

# script-training-data.jsonl   → from the VN script (do this first)
# training-data.jsonl          → 👍-rated bot logs
# combined-training-data.jsonl → both concatenated
DATASET_PATH = ROOT / "data" / "script-training-data.jsonl"
LORA_OUTPUT_DIR = HERE / "ghost-lora"
GGUF_OUTPUT_DIR = HERE / "ghost-gguf"
MAX_SEQ_LENGTH = 2048

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=BASE_MODEL,
    max_seq_length=MAX_SEQ_LENGTH,
    load_in_4bit=True,
)

model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    lora_alpha=32,
    lora_dropout=0,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    use_gradient_checkpointing="unsloth",  # big VRAM saving for a little speed
)

dataset = load_dataset("json", data_files=str(DATASET_PATH), split="train")

trainer = SFTTrainer(
    model=model,
    processing_class=tokenizer,   # older TRL: tokenizer=tokenizer
    train_dataset=dataset,
    args=SFTConfig(
        output_dir=str(LORA_OUTPUT_DIR),
        max_length=MAX_SEQ_LENGTH, # older TRL: max_seq_length=...
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        num_train_epochs=2,        # 1–3; more overfits a small dataset
        learning_rate=2e-4,
        logging_steps=5,
        save_strategy="epoch",
    ),
)

trainer.train()

model.save_pretrained(str(LORA_OUTPUT_DIR))  # keep the adapter on its own too
model.save_pretrained_gguf(str(GGUF_OUTPUT_DIR), tokenizer, quantization_method="q4_k_m")
print(f"✅ GGUF written to {GGUF_OUTPUT_DIR}")
```

What the settings mean. The defaults are sensible, so change one at a time:

| Setting | What it does | When to change it |
| --- | --- | --- |
| `DATASET_PATH` | Which `.jsonl` file to train on | When switching to the combined file |
| `MAX_SEQ_LENGTH` | Longest example, in tokens. Longer ones are cut. | Lower to 1024 if you run out of memory |
| `r`, `lora_alpha` | Adapter size and strength | Leave alone at first. `r=32, alpha=64` learns more but overfits sooner. |
| `per_device_train_batch_size` × `gradient_accumulation_steps` | Examples per training step (2 × 4 = 8) | Out of memory → batch 1, accumulation 8 |
| `num_train_epochs` | How many times it reads the whole dataset | 1 if she starts quoting the script; 3 if barely anything changed |
| `learning_rate` | Size of each adjustment | Halve it (`1e-4`) if the loss jumps around or goes to 0 |

Run it from the repo root, with the environment activated:

```powershell
python finetune\train_lora.py
```

What happens:

1. **The first run downloads the base model** (about 6 GB) from Hugging Face.
2. **Training starts** and prints a line every 5 steps, like
   `{'loss': 2.31, ...}`. One step is 8 examples, so about 420 examples × 2
   epochs is roughly 105 steps. Expect minutes rather than hours, depending on your GPU.
3. **The model is merged and exported to GGUF.** On the first run this
   downloads and builds llama.cpp, the converter, so it's the slowest and
   most fragile step.

**Reading the loss.** Loss measures how surprised the model is by her real
lines (lower = less surprised).

- **Healthy:** it starts high, drops over the first steps, then levels off.
- **Overfitting:** it heads towards 0, which means she's memorising the
  script. Use fewer epochs or a lower learning rate.
- **Too gentle:** it barely moves, so the training isn't changing much.

The training creates:

- `finetune\ghost-lora\`: the small adapter on its own.
- `finetune\ghost-gguf\…Q4_K_M.gguf`: the full model, about 5 GB, ready for Ollama.

> **✅ Training done when:** the script prints `✅ GGUF written to …` and a
> `.gguf` file of a few GB exists in `finetune\ghost-gguf\`.

#### C4. Turn it into an Ollama model

A GGUF file on its own doesn't tell Ollama how to lay out a conversation
for the model: where the system prompt goes, and where each turn starts
and ends. That layout is called the **chat template**. It has to match
Qwen3's, or the model will ramble or print gibberish.

1. **Copy Qwen3's template.** Run:
   ```powershell
   ollama show qwen3:8b --modelfile
   ```
   It prints a Modelfile. Copy the `TEMPLATE """…"""` block (it's long; take
   all of it) and any `PARAMETER stop …` lines.
2. **Write `finetune\Modelfile`.** Use the actual `.gguf` file name from
   `ghost-gguf\`. If Unsloth already wrote a `Modelfile` there, you can start
   from that one instead.
   ```dockerfile
   FROM ./ghost-gguf/<the-file>.Q4_K_M.gguf

   TEMPLATE """
   ...paste Qwen3's template here...
   """
   PARAMETER stop "<|im_end|>"     # use the stop lines from step 1
   ```
   There's no need for other `PARAMETER` lines here: the bot sends its own
   sampling settings from `.env`, and those override the Modelfile.
3. **Build it and say hi:**
   ```powershell
   cd finetune
   ollama create ghost -f Modelfile
   ollama run ghost "oi, you awake?"
   cd ..
   ```
   `ollama list` now shows `ghost`. It works like any other model.

**Alternative — adapter only.** Instead of a full GGUF, Ollama can load
just the adapter on top of the stock model. That's a smaller file, and you
can swap adapters easily:

```dockerfile
FROM qwen3:8b
ADAPTER ./ghost-lora
```

Whether this works for Qwen3 depends on your Ollama version, so check the
Modelfile docs. If `ollama create` refuses it, use the full GGUF.

> **✅ Ollama model ready when:** `ollama run ghost` replies with a normal,
> finished sentence (no gibberish, no endless rambling).

#### C5. Evaluate against the baseline

```powershell
npm run eval -- ghost
```

Open this file next to your latest `qwen3:8b` (or `ghost-base`) eval from
Level B. Both use the same prompt and the same RAG, so the only difference
is the fine-tune. For a fair verdict, ask a friend to read the two files
with the model names hidden and pick the reply that sounds more like her,
prompt by prompt.

> **✅ You're done with Level C when:**
> - `ghost` passes **at least as many** checklist items as the base model.
> - There are **no new kinds of failure**: no `Ghost:` prefixes, no
>   recited script lines, and she still dodges spoilers.
> - Both Safety prompts still pass. Grief replies come from the model, so a
>   fine-tune can break them.
> - In the blind read, her voice wins on **most of the other 16 prompts**.
>
> If it loses, the usual causes are too many epochs (she quotes the script),
> too little data (nothing changed), or a template mismatch (strange
> formatting). Fix one and retrain.

#### C6. Switch, iterate, roll back

- **Switch:** set `OLLAMA_MODEL=ghost` in `.env` and restart the bot.
- **Roll back:** set it back to `qwen3:8b` (or `ghost-base`) and restart.
  Nothing is lost.
- **Version your models:** name each round `ghost-v1`, `ghost-v2` and so
  on, so you can compare rounds with `npm run eval -- ghost-v1`. Delete old
  ones with `ollama rm`.
- **The long-term loop:** people rate replies on Discord, then you run
  `export:logs`, combine the files, retrain, evaluate and switch.

**Troubleshooting Level C**

| Problem | Cause and fix |
| --- | --- |
| `CUDA out of memory` | Batch size 1 with accumulation 8, and/or `MAX_SEQ_LENGTH = 1024`. Close games, browsers with video, and Ollama (`ollama ps`, then quit it from the tray). Ollama holds VRAM too. |
| `torch.cuda.is_available()` is `False` | The CPU-only PyTorch got installed. Run `pip uninstall torch`, then reinstall with the CUDA command from pytorch.org. Update your NVIDIA driver. |
| Unsloth or bitsandbytes install errors on Windows | Follow Unsloth's Windows instructions (they may need *Visual Studio Build Tools*), or switch to WSL2 (C2, step 5). |
| GGUF export fails while building llama.cpp | It needs `git`, `cmake` and a C++ compiler. Install *Visual Studio Build Tools* with "Desktop development with C++", or run the training in WSL2. The adapter in `ghost-lora\` is already saved, so you don't need to retrain. |
| `ollama run ghost` prints gibberish, `<|im_start|>` tokens, or never stops | Chat template mismatch. Redo C4 step 1, and make sure the `TEMPLATE` and `stop` lines were copied completely. |
| She recites script lines word for word | Overfitting. Use `num_train_epochs = 1`, or a lower learning rate. |
| She forgot the persona or speaks like an assistant | The training data may be out of date with `identity` and `style`. Re-export (C1) and retrain. Also check the prompt and RAG still work with `npm run eval -- qwen3:8b`. |
| Nothing seems different from the base model | There's too little data or too little training. Add 👍 logs, or try 3 epochs. |

---

## 5. Paths not yet in this codebase

Ideas that fit the current architecture, roughly in order of payoff.

### Training and model quality

- **Preference tuning (DPO/KTO).** 👎 ratings are already logged but unused —
  `export:logs` keeps only 👍. KTO works directly on thumbs-up/down labels.
  DPO needs pairs, which you could get by generating 2–3 replies per prompt
  and having raters pick one. TRL has `DPOTrainer` and `KTOTrainer`, and
  Unsloth supports both.
- **Hold-out split and eval script.** Export a fixed held-out set, run both
  models over it through Ollama, and score with an LLM-as-judge prompt.
  Score persona fit and staying in character.
- **A bigger model.** `qwen3:8b` leaves about 2.8 GB of a 12 GB card idle at
  a 16384 context. `qwen3:14b` (9.3 GB) may fit with a smaller context, and
  `qwen3:8b-q8_0` (8.9 GB) is the same size at higher precision. Neither has
  been tested here, so compare them with `npm run eval -- <model>`.
- **More languages.** The bot was English-only by choice. The script has
  parallel JP and CN columns, so it could be extended again.
- **Synthetic Discord-style data.** Rewrite script contexts into casual chat
  messages with a bigger model, so training "user" turns look like real
  users.

### Retrieval

- **Hybrid search for scenes.** Fact cards already combine names and embeddings
  (§4.3). Scene retrieval could do the same with BM25 / keyword scoring, for
  names and catchphrases that embeddings blur.
- **Reranking.** Retrieve ~20 chunks and rerank with a cross-encoder (e.g.
  `bge-reranker-v2-m3`) down to `RAG_TOP_K`.
- **Query with history.** Embed the last few turns, not just the latest
  message, so follow-ups like "why?" retrieve something useful.
- **Vector store.** `index.json` is loaded whole into memory and scanned
  linearly. That's fine for hundreds of chunks. For thousands, use
  `sqlite-vec` or LanceDB.
- **`/api/embed`.** The code uses Ollama's older `/api/embeddings` endpoint.
  The newer `/api/embed` accepts batches, which would make indexing much
  faster.
- **Scene-aware chunking.** Split on scene breaks or file sections instead of
  fixed 10-line windows.

### Conversation and runtime

- **Persistent history and memory.** Store history in SQLite so it survives
  restarts. Add per-user facts ("Captain likes X") that are summarised and
  injected.
- **Streaming replies.** Use `stream: true` and edit the Discord message as
  tokens arrive.
- **Long replies.** Split at 2,000 characters instead of truncating.
- **Request queue.** One local GPU serves everyone. Queue requests per
  channel and rate-limit, so a busy server doesn't time out every reply.
- **Tool calling.** Qwen3 supports tools in Ollama. Expose `remind`,
  `quote`, etc. as tools so "remind me in 10 min to stretch" works in chat.
- **Persistent reminders.** `/remind` uses `setTimeout`, so reminders are lost
  on restart. Store them and reschedule them on `ready`.
- **Multiple personas.** Make `character.js` a directory of personas and pick
  one per guild or channel. RAG would need an index per persona.
- **Voice.** discord.js voice + speech-to-text + a TTS voice for the
  character.

---

## 6. Known limitations

- Chat history is in memory and per channel. It's lost on restart, and
  everyone in a channel shares it.
- If an Ollama call fails, the user's message stays in history without a
  reply, so the next request has two user turns in a row.
- `/remind` reminders don't survive a restart.
- `src/safety.js` is keyword matching. It misses indirect wording and anything
  not in English, and it can be set off by jokes. It's a safety net, not a way
  of detecting someone in danger.
- History is per channel, so one person's crisis message gives everyone in that
  channel the fixed reply for about 10 messages. Once that ends, she's normal
  Ghost again with no memory of it.
- The bot is English-only: messages in other languages get English replies.
- Replies stop at about 65 words, so she can't deliver a long rant even when
  it would suit the moment. Raise `OLLAMA_MAX_REPLY_TOKENS` to allow it.
- About 74 Prettier formatting errors remain in the existing code. They're
  formatting only — run `npx eslint . --fix` to apply them.
