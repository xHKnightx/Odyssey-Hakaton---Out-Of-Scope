# Connect a Google account locally

Calendar Breather uses Google OAuth directly from this local app. It requests these scopes:

- `calendar.events`: read calendar events and create reviewed recovery blocks.
- `gmail.readonly`: search recent mail for participants of upcoming meetings and read message metadata/snippets for a local sentiment estimate.
- `openid email profile`: show which Google account is connected.

Email bodies are not fetched or stored. The app keeps the OAuth token in `data/google-token.json` with owner-only file permissions. The database stores only proposal times and Google event IDs, not email snippets or calendar descriptions. The entire `data/` folder and `.env` are excluded from Git.

## Google Cloud setup

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select or create a project.
2. In **APIs & Services → Library**, enable **Google Calendar API** and **Gmail API**.
3. Configure **Google Auth Platform** / OAuth consent. For a personal showcase, use **External** and **Testing**, then add the Google account you will connect as a test user. For a Google Workspace account, an administrator may need to permit the Gmail and Calendar scopes.
4. Create an OAuth client with application type **Web application**.
5. Add this exact authorized redirect URI: `http://localhost:3000/auth/google/callback`.
6. Copy `.env.example` to `.env` in the project root. Put the OAuth client ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Do not commit or share `.env`.
7. Restart the local app and open **Connections → Connect Google**. Review the consent screen and sign into the account whose calendar you want to analyze.

If Google reports `access_denied`, the account may not be listed as an OAuth test user, the Workspace administrator may block the scopes, or an API is not enabled.

## Running Calendar Breather

1. In PYTHIA, open Oracle and seek help with a calendar-heavy week.
2. Select **Run it on my week**. With Google connected, PYTHIA reads the primary calendar for the next five days and looks at up to 30 days of recent Gmail snippets involving meeting participants.
3. The app estimates meeting strain using duration, attendee count, calendar density, and a transparent local phrase-based sentiment estimate. It does not call an LLM for sentiment.
4. Review suggested 20-minute gaps. Select the ones to add. Optionally enter colleague emails if you intend to send them calendar invitations. **Add selected breaks** writes events to your primary calendar; if invitees are entered, Google sends them calendar invitations.

The demo fallback uses seeded mockup events and never writes them to Google Calendar. A write occurs only when you press the confirmation button.
