# ColabControl

Web dashboard for managing **Google Colab** runtimes and notebooks through the official [`google-colab-cli`](https://pypi.org/project/google-colab-cli/), integrated with Google Drive and GitHub notebook imports.

## Features

- **Google Account + Google Drive sync:** List, start, stop, and delete `.ipynb` notebooks stored in your Drive (`Colab Notebooks` or anywhere in Drive).
- **GitHub import:** Paste a GitHub repo or `.ipynb` URL and save imported notebooks directly into Google Drive.
- **Runtime management:** Provision and stop Colab runtimes (`CPU`, `T4`, `L4`, `A100`, `H100`, `TPU v5e-1`, `TPU v6e-1`) via `google-colab-cli`.
- **Per-notebook environment variables:** Inject custom `KEY=VALUE` environment variables into notebook runs without logging secret values.
- **Live resource metrics & logs:** Stream real-time CPU, RAM, GPU, VRAM, disk usage, and cell execution logs over SSE.
- **Zero-setup CLI bootstrap:** On every server boot, `server.ts` automatically downloads `uv`, installs Python 3.12, and installs `google-colab-cli` in the background if it is missing.

---

## Deploying to Koyeb (Free Tier)

### 1. Push your code to GitHub

1. Create a new GitHub repository (public or private).
2. Commit and push all project files.
   - `.gitignore` already excludes `node_modules/`, `dist/`, `.colab-venv/`, and `.colab-tools/` — do **not** commit virtual environments.
   - Make sure `firebase-applet-config.json` is included if you are reusing the existing Firebase project (or replace it with your own Firebase Web App config — see Step 2 under Auth).

### 2. Create the Service on Koyeb

1. Sign in to [Koyeb](https://app.koyeb.com/) and click **Create Web Service**.
2. Choose **GitHub** and select your repository and branch.
3. Under **Builder**, select **Buildpack** and set:
   - **Build command:** `npm install && npm run build`
   - **Run command:** `npm start`
     *(If your Koyeb environment picks an older Node.js version below 22.18, set the Run command to `npx tsx server.ts` instead.)*
4. Under **Environment variables & files**, add:
   - `NODE_ENV` = `production`
   - `PORT` = `3000`
5. Under **Exposed ports / Health checks**:
   - **Port:** `3000`
   - **Protocol:** `HTTP`
   - **Public path:** `/`
6. Select the **Free** instance type and click **Deploy**.

### 3. Wait for First-Boot CLI Install

Once Koyeb shows the service as **Healthy**, open your `https://<your-app>.koyeb.app` URL.
- On cold start, the server automatically installs `uv`, Python 3.12, and `google-colab-cli` in ~5–15 seconds while the UI loads.
- Go to **Runtimes** in the sidebar; once **Installing google-colab-cli...** finishes, the button will switch to **Connect Colab CLI**.

> **Note about Koyeb Free Tier & background jobs:** Closing your browser tab will **not** stop a running Colab notebook because `colab exec` runs on the Koyeb server. However, Koyeb's free tier may spin down an instance after extended periods with zero incoming HTTP requests (or restart on redeploys).

---

## Authentication Setup

This app uses two separate logins:
1. **Google Account & Drive Sign-In** (to read/save `.ipynb` notebooks in Google Drive)
2. **Colab CLI Sign-In** (to create/stop Colab runtimes and execute notebooks)

### Part A: Google Account & Google Drive Login (Required for your new Koyeb URL)

Firebase Authentication blocks sign-in popups from unknown domains by default. After Koyeb gives you your live URL (e.g. `my-colab-app.koyeb.app`), add it to Firebase:

1. **Add your Koyeb domain in Firebase Console:**
   - Open [Firebase Console](https://console.firebase.google.com/) and select project **`gen-lang-client-0141868049`** (or your own Firebase project if you replaced `firebase-applet-config.json`).
   - Go to **Authentication** → **Settings** → **Authorized domains**.
   - Click **Add domain** and enter your Koyeb hostname without `https://` (for example: `your-app-name.koyeb.app`).

2. **Add your Google account as a Test User (fixes `Error 403: access_denied`):**
   - Open [Google Cloud Console — Google Auth Platform Audience](https://console.cloud.google.com/auth/audience?project=gen-lang-client-0141868049).
   - Keep **Publishing status** as **Testing** (no Google verification review required for personal use).
   - Under **Test users**, click **+ Add users** and add the Gmail account(s) you will use to sign in (e.g. `fakemailcloud09@gmail.com`).

3. **Verify Google Drive API is enabled:**
   - Open [Google Drive API in Cloud Console](https://console.cloud.google.com/apis/library/drive.googleapis.com?project=gen-lang-client-0141868049) and ensure it shows **API Enabled**.

*(Optional — using your own Firebase project instead: Create a Firebase project, enable **Authentication → Google provider**, enable **Google Drive API** in its Google Cloud project, and replace `firebase-applet-config.json` with your Web App config.)*

---

### Part B: Connect Google Colab CLI

No Google Cloud or Firebase configuration is needed for this step:

1. Open your deployed Koyeb dashboard and select **Runtimes** from the left sidebar.
2. Click **Connect Colab CLI**.
3. Click **Open Google Sign-In**, approve access with your Google account, and copy the authorization code shown on the landing page.
4. Paste the authorization code into the dialog and click **Connect CLI**.

Once connected:
- Click **Start** on any notebook from **Dashboard** or **Notebooks** (choose an existing runtime or `Auto: CPU` / `Auto: T4 GPU` / `Auto: L4 GPU` / `Auto: A100 GPU`).
- Monitor live GPU/CPU/RAM metrics and cell logs in real time.

---

## Running Locally (Optional)

Requires **Node.js >= 22.18**:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.
