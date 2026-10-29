# Doppel

A desktop twin for Windows and macOS. Tell it in one line what you want handled, and it works through your inbox, browser, forms, and reminders the way you would, checking with you according to the approval mode you pick.

A clean-room rebuild of the ideas behind Twinly, written from scratch.

**Website:** https://raman2221.github.io/doppel/

**Download:** [Mac (Apple Silicon)](https://github.com/raman2221/doppel/releases/latest/download/Doppel-mac-arm64.dmg) · [Windows](https://github.com/raman2221/doppel/releases/latest/download/Doppel-windows-x64-setup.exe) · [All releases](https://github.com/raman2221/doppel/releases)

## Run from source

```bash
npm install
npm start
```

Then open **Settings**:

1. **Claude**: paste an API key from console.anthropic.com.
2. **Email** (optional): your address plus an *app password*. For Gmail, turn on 2-Step Verification and create one at myaccount.google.com/apppasswords.
3. **Memory → How you write**: train Doppel on your sent mail so its emails sound like you.

## Built for small machines

Doppel is tuned to run well on a base 8 GB MacBook Air (M1 or later):

- **About 110 MB of private memory** with the window open, measured on Windows. Most of Electron's usual overhead is the GPU process, and Doppel renders in software because its window is text and cards; pass `--gpu` to turn hardware acceleration back on.
- **Closing the window frees its memory.** Doppel keeps running in the menu bar or tray, so reminders still fire and tasks keep working.
- **Heavy libraries load on first use.** Mail, PDF, and browser automation cost nothing until you use them.
- **The errand browser closes itself** after 3 idle minutes, with fewer tab processes than normal Chrome. Sign-ins persist.
- **Finished tasks leave memory** after two minutes and reload from disk when opened. Only the latest 200 tasks are kept.
- **Reliable on laptops:** macOS App Nap can't throttle a running task, reminders are checked again on wake from sleep, network calls time out and retry, and main-process errors go to `doppel.log` instead of crashing the app.

### Installing on a Mac

1. Download `Doppel-mac-arm64.dmg` from the [latest release](https://github.com/raman2221/doppel/releases/latest) and drag Doppel to Applications.
2. The build isn't notarized by Apple yet. If macOS blocks it, open **System Settings → Privacy & Security** and click **Open Anyway**.
3. Install Google Chrome if you want browser errands.

To run from source on a Mac instead: install Node 22+ (`brew install node`), clone the repo, then `npm install` and `npm start`. `npm run dist:mac` builds the `.dmg` yourself.

`Ctrl+Shift+Space` (`⌘⇧Space` on Mac) opens Doppel from anywhere.

## What it does

| Ability | How |
|---|---|
| Inbox in your voice | Reads, archives, drafts, and sends over IMAP/SMTP, using a style guide learned from your sent mail |
| Browser errands | Drives a real Chrome (or Edge) window with its own profile; fills fields by label, clicks buttons by text, and re-reads the page after every step |
| Memory & reminders | Facts about you, people with birthdays, and reminders that can start a task on their own when due |
| Form filling | Fills PDF forms from what it knows and saves a "(filled)" copy; never touches the original |

## Safety model

- **Approval modes**: *Ask me every time*, *Ask before it ships* (default), *Don't ask* (emails get a cancellable 5-second preview).
- Payments and messages to people marked as family **always** wait for you.
- Doppel never types or stores SSNs, passwords, or card and bank numbers, in forms, web pages, or memory.
- **Undo** for 30 minutes on anything that stays local: reminders, memory, filled forms, archived mail, drafts.
- **Audit log**: every action is recorded with a SHA-256 hash chained to the entry before it (latest 1,000 kept). *Activity → Verify integrity* checks the chain.
- Keys and passwords are encrypted with the OS keychain (Electron `safeStorage`) and redacted from anything sent to Claude.
- Stopped tasks resume from their saved history without repeating steps that already succeeded.

## Layout

```
src/main/main.js         window, tray, global shortcut, IPC, reminder scheduler
src/main/agent.js        task loop: Claude tool use, approvals, stop/resume
src/main/approvals.js    approval modes and the send preview
src/main/audit.js        hash-chained activity log
src/main/undo.js         30-minute undo journal
src/main/secrets.js      OS-encrypted secrets
src/main/tools/          email, browser, memory, reminders, forms, sensitive-data guard
src/main/preload.cjs     the only bridge the page gets
src/renderer/            the interface
website/                 the download site, published to GitHub Pages
.github/workflows/       builds installers on version tags; deploys the site
test/                    node --test suite (runs without Electron)
```

Data lives in Electron's user-data folder (`%APPDATA%\doppel\data` on Windows).

```bash
npm test
```

## Releasing

Push a version tag and GitHub Actions builds the Mac `.dmg` (on Apple Silicon) and the Windows installer, then attaches both to a release:

```bash
npm version patch
git push --follow-tags
```
