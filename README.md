# 🌙 Midnight Mafia

An online Mafia party game for you and your friends. Everyone plays on their own phone or laptop.

**Features**
- 26 roles across Town, Mafia and Neutral, dealt at random or picked by the host
- The group votes for a host, or the game runs itself on timers
- Play or spectate, with drop-out recovery and rejoining
- Live voice chat that follows the game rules (Mafia-only at night)
- Chat with stickers, pictures and voice messages
- Phone-first design with bottom tabs, vibration and keep-awake
- A secret x-ray mode that only the person with the key can use

---

## Quick start

```bash
npm install
npm start
```

Open **http://localhost:3000**. The console also prints a link for friends on your Wi-Fi, and your secret x-ray key.

### Play with friends anywhere

Double-click **`scripts/play-online.bat`**. It starts the game and prints a public `https://….trycloudflare.com` link to send your friends.
The link changes every time, and it only works while that window is open.

<details>
<summary>Other ways to go online</summary>

1. **Quick tunnel by hand:** install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), run `npm start`, then
   `cloudflared tunnel --url http://localhost:3000`.
2. **Free hosting:** see [Host it in the cloud](#️-host-it-in-the-cloud-no-computer-needed) below.

</details>

### ☁️ Host it in the cloud (no computer needed)

The game runs on [Render](https://render.com)'s free plan, so your computer can stay off. The project already has a ready-made `render.yaml`.

1. Put this folder in a **private** GitHub repository. `secret.json` and `node_modules` are never uploaded.
2. On Render: **New → Blueprint**, then pick that repository.
3. When Render asks for **`CHEAT_KEY`**, type your secret x-ray key, then click **Deploy**.
4. Share the `https://….onrender.com` link. It stays the same forever.

Things to know about the free plan:
- **First visit after a quiet spell:** after 15 minutes with nobody playing, the game sleeps. The next visit takes about a minute to wake it up. While people are playing (even just in voice chat), it stays awake.
- **Traffic limit:** 5 GB of traffic a month is included, roughly 30 hours of voice-chat games, and far more with text chat only. Without a card on the account, Render simply pauses the game until next month and never charges you.
- **New versions:** pushing changes to GitHub redeploys the game automatically. Each restart wipes the rooms, as always.
- **Server location:** set to Frankfurt (Europe). To change it, edit `region:` in `render.yaml` to `oregon`, `ohio`, `virginia` or `singapore`.

---

## Project structure

```
mafia/
├── server/                 Game server (Node.js, Express, Socket.IO)
│   ├── index.js            Entry point: web server, privacy headers, startup
│   ├── config.js           Port and the secret x-ray key
│   ├── rooms.js            Rooms, players, creator, host and spectators
│   ├── game.js             Dealing roles, phases, night actions, voting, win checks
│   ├── views.js            What each player may see and hear (chat, voice, roles)
│   ├── sockets.js          Every action the browser can send (join, vote, chat…)
│   ├── media.js            Chat pictures and voice messages (in memory only)
│   ├── hub.js              Shared live-connection handle
│   └── util.js             Small helpers
├── shared/
│   └── roles.js            All 26 roles and the stickers (used by server and browser)
├── public/                 The website
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   ├── assets/icon.svg
│   └── manifest.webmanifest   Lets players "Add to Home Screen"
├── scripts/
│   └── play-online.bat     One-click public link (Windows)
├── test/                   Automated tests (npm test)
├── secret.json             Your x-ray key. Private, never uploaded (git-ignored)
├── render.yaml             Cloud hosting setup (Render)
└── package.json
```

---

## How a game works

1. Someone taps **Create a new room** and shares the 4-letter code, or **🔗 Copy invite link**.
2. **Play or watch:** each person picks **🎮 Play** or **👀 Just watch**.
   - Spectators get no role but see every role and night move.
   - During a game, spectators can only chat in the Graveyard.
   - Anyone who arrives mid-game joins as a spectator.
3. **Choose the host together:**
   - 🎙️ **A player hosts:** everyone taps **Vote host**. The most votes wins, and ties are broken at random.
     - The creator can **Finish vote now** or pick a **🎲 Random host**.
     - With **The host also plays** on, the host gets a secret role like everyone else and just moves the game along.
     - With it off, the host sits out, sees everything, and narrates.
   - 🤖 **No host (auto):** everyone plays, and the game runs on timers.
4. The host sets the **max players**, **how many Mafia**, and the roles:
   - **🎲 Random:** shuffles the roles out. **Surprise setup** picks a balanced mix.
   - **✍️ Host picks:** the host gives each player a role by hand.
5. Each round goes Night → Morning → Discussion → Vote, and repeats until a team wins.

Balance tip: about 1 Mafia for every 4–5 players. The lobby shows a recommendation.

### The 26 roles

| Team | Roles |
|---|---|
| **Town** | Citizen, Detective, Doctor, Bodyguard, Vigilante, Mayor, Veteran, Tracker, Lookout, Medium, Escort, Miller, Witch |
| **Mafia** | Mafioso, Godfather, Framer, Consigliere, Silencer, Janitor, Consort |
| **Neutral** | Jester, Serial Killer, Arsonist, Survivor, Executioner, Cupid |

Tap **📖** in the game to read what every role does.

---

## 🎙️ Voice chat

Tap **🎙️ Join voice**, then **Allow mic**.
- Your mic **only sends while you talk**, and goes quiet about half a second after you stop.
- A green ring glows around whoever is speaking.
- 🎤 mutes and unmutes you.
- 🎚️ sets how loud you need to talk before your mic turns on: Low for a noisy room, High if your voice isn't picked up.
- **The game decides who hears whom:**
  - At night, only the Mafia hear each other.
  - The dead and spectators talk among themselves.
  - A silenced player can't be heard that day.

The voice goes through the server, so it works on any network. On laptops, use headphones to avoid echo.

## 💬 Chat extras

- 😀 **Stickers:** 20 Mafia stickers (SUS, LIAR, Trust me, RIP…)
- 🖼️ **Pictures:** shrunk on the phone before sending, so the original photo's hidden details never leave the device.
- 🎤 **Voice messages:** up to 60 seconds. They play on every phone, iPhone included.

They follow the same rules as text. Pictures and voice messages are deleted when the room closes.

## 🔒 Privacy: they come, they play, they go

Players don't need an account, and nothing about them is collected, kept or shared.

| | |
|---|---|
| **Accounts / sign-up** | None. Players only type a nickname for the game. |
| **Cookies, analytics, ads, trackers** | None. Also blocked by the server's rules. |
| **Outside servers** | None. Fonts are served by the game itself (no Google Fonts or CDNs). The browser is told it may only talk to this server (`Content-Security-Policy`). |
| **Camera, location, sensors, Bluetooth, USB, screen capture, ad-tracking APIs** | Switched off for the whole site (`Permissions-Policy`). The mic request explicitly says `video: false`. |
| **Microphone** | Used only after the player taps **Allow mic**, and only while they're in voice chat or recording. |
| **Voice chat** | Live only, never recorded. |
| **Server logs** | The server never logs names, messages, IP addresses or anything else about players. `npm test` checks this. |
| **Storage on the server** | Memory only, never written to disk. When everyone has left a room, its names, chat, pictures and voice messages are wiped within 5 minutes. |
| **Storage on the phone** | Only for the open tab (`sessionStorage`), so closing the tab forgets them. Tapping **Leave** also resets their anonymous id. Pictures are never cached. |
| **Pictures** | Re-drawn on the phone before sending, which strips hidden location and camera details. |
| **Narrator 🔊** | Uses only voices built into the device. Online voices, which would send the text to Google or Microsoft, are never used. |
| **Referrer** | Never sent (`no-referrer`). |

**Your choice of network:** when you share a public link with `scripts/play-online.bat`, the traffic passes through Cloudflare's free tunnel, like any website on the internet. Cloudflare doesn't receive any extra data from the game.
For zero outside involvement, play on the same Wi-Fi with the `http://192.168…` link.

The one thing kept long-term is **your own x-ray key**, on **your own device**, and only if you enter it.

---

## 🤫 The secret x-ray (only for you)

1. Open the hidden box:
   - **On a computer:** type `xray` anywhere outside a text box.
   - **On a phone:** tap the 🌙 logo 5 times fast.
2. A harmless-looking **"Theme code"** box opens. Enter your key, which is shown in the server console and stored in `secret.json`.
3. Every player's role appears as a faint label on their card.
   - Press **`** (backtick) to hide or show the labels.
   - Your device remembers the key.

The key is checked on the server. A friend who finds the trick still can't use it without your key, and 5 wrong tries locks them out.
To change the key, edit `secret.json` (or set `CHEAT_KEY`) and restart the server.

## If someone drops out

- **The host disconnects:** the creator, or the next connected person, gets the host buttons, so the game never freezes.
- **The creator leaves:** creator powers pass to the next connected person.
- **Someone refreshes or their phone sleeps:** they open the link again and get their seat back automatically.

---

## Development

```bash
npm run dev     # restarts automatically when you edit a file
npm test        # runs every test on a separate port (3999)
```

Add `VERBOSE=1` before `npm test` to also print full game logs. The tests cover:
- three full games that use all 26 roles
- role-leak and x-ray checks
- the host election
- spectators and drop-outs
- voice routing rules
- chat media validation
- privacy: no outside servers, no cookies, strict browser rules, no player data in server logs, rooms wiped after everyone leaves
