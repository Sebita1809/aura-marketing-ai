# OAuth Multi-Platform Configuration

## 1. Meta for Developers (Facebook / Instagram / Threads)

### Prerequisites
- A Facebook account (use a business account for production)
- Your Supabase project ref (the subdomain in your `VITE_SUPABASE_URL`)

### Steps

1. Go to [Facebook Developers](https://developers.facebook.com) and create a new app.
2. Choose **Business** as the app type (required for Instagram, Threads, and Pages).
3. Once created, navigate to **Dashboard** → **Add Product** and select **Facebook Login for Business**.
4. Under **Facebook Login for Business** → **Settings**:
   - Add the following **Valid OAuth Redirect URIs**:

     ```
     https://[project-ref].supabase.co/functions/v1/auth-meta-callback
     ```

5. Add the following products as needed:
   - **Instagram** (for Instagram Basic Display / Instagram Graph API)
   - **Threads** (for Threads API)
   - **Pages** (for Facebook Page management)
6. Go to **Settings** → **Basic** and copy:
   - **App ID** → set as `VITE_META_APP_ID`
   - **App Secret** → set as `META_APP_SECRET`

### Environment Variables

```env
VITE_META_APP_ID=your_meta_app_id
META_APP_SECRET=your_meta_app_secret
```

---

## 2. X / Twitter API v2

### Prerequisites
- An X Developer account (apply at [developer.twitter.com](https://developer.twitter.com))
- Your Supabase project ref

### Steps

1. Go to [X Developer Portal](https://developer.twitter.com) and sign in.
2. Create a new **Project** and then an **App** within that project.
3. In the app settings, enable **OAuth 2.0 with PKCE** (also known as OAuth 2.0 Authorization Code Flow with PKCE).
4. Configure the **Callback URL**:

   ```
   https://[project-ref].supabase.co/functions/v1/auth-x-callback
   ```

5. Under **Keys and Tokens**, copy:
   - **OAuth 2.0 Client ID** → set as `VITE_X_CLIENT_ID`
   - **OAuth 2.0 Client Secret** → set as `X_CLIENT_SECRET`

### Environment Variables

```env
VITE_X_CLIENT_ID=your_x_client_id
X_CLIENT_SECRET=your_x_client_secret
```

---

## 3. Supabase Configuration

### Edge Function Secrets

The `META_APP_SECRET` and `X_CLIENT_SECRET` are **server-side only** (not prefixed with `VITE_`). They must be set as Supabase Edge Function secrets so the callback functions can access them.

#### Using the Supabase CLI

```bash
supabase secrets set META_APP_SECRET=your_meta_app_secret
supabase secrets set X_CLIENT_SECRET=your_x_client_secret
```

#### Using the Supabase Dashboard

1. Go to your Supabase project dashboard.
2. Navigate to **Edge Functions** → **Secrets**.
3. Add each secret key-value pair.

### Client-Side Variables

The `VITE_`-prefixed variables go in your `.env` file (or `.env.local`) and are bundled at build time by Vite. These are safe to expose to the browser.

```env
VITE_SUPABASE_URL=https://[project-ref].supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_META_APP_ID=your_meta_app_id
VITE_X_CLIENT_ID=your_x_client_id
```

---

## Reference: Callback URLs

| Platform | URL |
|----------|-----|
| Meta | `https://[project-ref].supabase.co/functions/v1/auth-meta-callback` |
| X | `https://[project-ref].supabase.co/functions/v1/auth-x-callback` |

Replace `[project-ref]` with your actual Supabase project reference (found in your Supabase dashboard under **Settings** → **API**).
