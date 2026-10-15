# Connect a Google account locally

Calendar Breather uses Google OAuth directly from this local app. Its planning flow requests these scopes:

- `calendar.events`: read calendar events and create reviewed recovery blocks.
- `calendar.readonly`: read primary-calendar metadata such as its timezone. Reauthorize if Connections reports this permission missing.
- `gmail.readonly`: retained for the separate legacy meeting sentiment analysis route; recovery-break planning never reads Gmail.
- `openid email profile`: sign in to PYTHIA and show which Google account is connected.

Email bodies are not fetched or stored. The app keeps each person's OAuth token in `data/google-tokens/<profile id>.json` with owner-only file permissions. The database stores only proposal times and Google event IDs, not email snippets or calendar descriptions. The entire `data/` folder and `.env` are excluded from Git.

## Google Cloud setup

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select or create a project.
2. In **APIs & Services → Library**, enable **Google Calendar API**. Enable **Gmail API** only if you use the separate legacy sentiment analysis route.
3. Configure **Google Auth Platform** / OAuth consent. For a personal showcase, use **External** and **Testing**, then add the Google account you will connect as a test user. For a Google Workspace account, an administrator may need to permit the requested scopes.
4. Create an OAuth client with application type **Web application**.
5. Add this exact authorized redirect URI: `http://localhost:3000/auth/google/callback`.
6. Copy `.env.example` to `.env` in the project root. Put the OAuth client ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Do not commit or share `.env`.
7. Restart the local app and open **Connections → Connect Google**. Review the consent screen and choose the Google account you signed in to PYTHIA with; another account is refused.

If Google reports `access_denied`, the account may not be listed as an OAuth test user, the Workspace administrator may block the scopes, or an API is not enabled.

## Signing in to PYTHIA with Google

The same OAuth client and the same redirect URI (`http://localhost:3000/auth/google/callback`) also serve the sign-in page, so there is nothing extra to register. Sign-in requests only `openid email profile` and accepts only accounts on `AUTH_ALLOWED_DOMAINS` (default `t1a.com`); Calendar and Gmail scopes are requested later, from **Connections → Connect Google**. Gmail is used only by the separate legacy calendar analysis route, not to plan recovery breaks.

- While the OAuth consent screen is **External / Testing**, only the accounts listed as test users can complete either step. Add every teammate who will sign in.
- **Connect Google** only accepts the Google account you signed in with. If you pick another account, the connection is refused and the grant is revoked.
- Each person has their own token file in `data/google-tokens/<profile id>.json` (owner-only permissions). A token saved by the earlier single-user version (`data/google-token.json`) is handed to the profile with the same email the first time that person signs in.
- To demo on a real calendar, sign in on the demo machine as the calendar's owner and connect Google there.

## Planning and scheduling recovery breaks

1. Open Calendar Breather from Oracle. Sign in and connect the same Google account under Connections.
2. Open **Calendar Breather** and choose Gentle, Balanced, or Extra room mode and whether the analysis loop runs once daily or once weekly. PYTHIA selects a break count and 5/7/8/9/10/15-minute durations.
3. PYTHIA analyzes the next seven days on each pass and previews weekdays with existing events alongside suggested break holds inside the app. By default, event content remains local and the model sees only sanitized load counts and free candidate slots. Related email subjects/snippets and prior meeting titles are included by default for LLM sentiment analysis; uncheck the context option to keep them out; attendee addresses and full email bodies are never sent.
4. The Oracle decides how many breaks suit the next seven days, counting existing holds in that window. PYTHIA adds the selected holds tentatively to your calendar. Open the invitation list in Connections and accept or decline each hold; accepting confirms it, declining removes it.

The planning flow requires a connected Google Calendar and does not substitute seeded demo events. The automation runs while the local server is running; overdue jobs are analyzed once after restart. Use the Connections page to pause or resume the Oracle loop. Later calendar changes can introduce conflicts, so review the calendar after scheduling.

For a demo, choose **Previous week** in the Calendar Breather preview. PYTHIA replays that week using a read-only simulation; the suggested past breaks are not written to Google Calendar.
