# PiepsLama

An autonomous Minecraft bot powered by Mineflayer and a local LLM.  The project is split into modular components for bot control, queue management and learning.

## Installation

1. Install **Node.js 18** or newer.
2. Clone this repository and install the dependencies:

```bash
npm install
```

## Configuration

1. Copy the provided environment template and adjust the values:

```bash
cp .env.example .env
```

2. Edit `.env` to match your environment.  Important options include:
   - **Minecraft connection** – `MINECRAFT_HOST`, `MINECRAFT_PORT`, `MINECRAFT_VERSION` and `MINECRAFT_AUTH`.
   - **Bot credentials** – `BOT_USERNAME` and `BOT_PASSWORD` (only required for online/microsoft auth).
   - **LLM settings** – `OLLAMA_HOST`, `OLLAMA_MODEL` and `OLLAMA_TIMEOUT`.
   - **Logging and performance** – options such as `LOG_LEVEL`, `LOG_TO_FILE` and `STATUS_UPDATE_INTERVAL`.
   - **Memory and debug** – parameters like `MAX_LEARNINGS_PER_CATEGORY` or `VERBOSE_LLM_LOGGING`.

The `.env.example` file documents all available variables with sane defaults.

## Running the bot

Start the bot using the npm script:

```bash
npm start
```

During development you can run with trace warnings enabled:

```bash
npm run dev
```

Log files are written to the `Logs/` directory when `LOG_TO_FILE` is enabled.

### Maintenance scripts

- `npm run clean-logs` – remove all log files.
- `npm run reset-memory` – clear stored queue memories.
- `npm run full-reset` – run both cleanup tasks.

