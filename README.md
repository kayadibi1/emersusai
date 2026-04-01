# emersus ai Waitlist

Static waitlist website for a science-based AI chatbot focused on fitness, exercise, nutrition, and supplements.

## Files

- `docs/index.html` is the GitHub Pages source of truth.
- `docs/styles.css` contains the custom font, gradient, and interaction styles.
- `docs/script.js` handles the rotating prompt text and waitlist form submission.
- The root `index.html`, `styles.css`, and `script.js` mirror the `docs/` files for local preview convenience.

## Deploy on GitHub Pages

1. Push this repository to GitHub.
2. In the repository settings, open `Pages`.
3. Set the source to deploy from your default branch.
4. Choose the `/docs` folder.
5. The site will serve `docs/index.html`.

## Collect waitlist emails

GitHub Pages does not provide a backend for storing form submissions. To collect emails, use a form service such as Formspree, Basin, or Getform.

1. Create a form endpoint with your provider.
2. Open `docs/index.html`.
3. Add the endpoint URL to each `data-form-endpoint` attribute on the forms marked with `data-waitlist-form`.

Example:

```html
<form
  class="group flex max-w-md flex-col gap-0 sm:flex-row"
  data-form-endpoint="https://formspree.io/f/your-form-id"
  data-waitlist-form
  id="waitlist-form"
  method="post"
  novalidate
>
```

## Local preview

You can preview locally with any static server. For example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
