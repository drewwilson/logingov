# How-To: Running Login.gov Locally & in Production

## Prerequisites

- Node.js >= 18
- pnpm 10.9+

## Local Development

### 1. Install dependencies

From the project root:

```sh
pnpm install
```

### 2. Set up the test database

```sh
cd test-migration
pnpm run reset
pnpm run migrate
pnpm run start
```

Then open [http://localhost:4321/database.html](http://localhost:4321/database.html) to browse the database data.

### 3. Run the dev server

From the project root:

```sh
pnpm run dev
```

Then open [http://localhost:8787/demo](http://localhost:8787/demo) to see the demo page. You can try logging in, logging out, and other auth flows from there.

### 4. View the project plan

Open `inital_plan/index.html` in a browser to see detailed documentation on the project as a whole.

## Production

### Sign up / Sign in (live)

Go to [https://logingov.drew-206.workers.dev/sign-in](https://logingov.drew-206.workers.dev/sign-in) to try the live sign-up and sign-in flows.

### Full OIDC flow (demo agency)

Before testing the full OIDC flow, you need to register an agency:

1. Start the agency admin dev server from the project root:

   ```sh
   pnpm run dev:agency
   ```

2. Open [http://localhost:5176/](http://localhost:5176/) and add an agency.

3. Once the agency is registered, go to [https://logingov-demo-agency.drew-206.workers.dev/](https://logingov-demo-agency.drew-206.workers.dev/) to test the full OIDC flow end-to-end.
