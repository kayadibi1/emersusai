# emersus ai Waitlist

Static waitlist website for a science-based AI chatbot focused on fitness, exercise, nutrition, and supplements.

## Files

- `index.html` contains the landing page content.
- `styles.css` contains the responsive visual design.
- `script.js` handles basic form validation and submission.

## Deploy on GitHub Pages

1. Push this repository to GitHub.
2. In the repository settings, open `Pages`.
3. Set the source to deploy from your default branch.
4. The site will serve `index.html` automatically.

## Collect waitlist emails

GitHub Pages does not provide a backend for storing form submissions. To collect emails, use a form service such as Formspree, Basin, or Getform.

1. Create a form endpoint with your provider.
2. Open `index.html`.
3. Add the endpoint URL to the `data-form-endpoint` attribute on the form with id `waitlist-form`.

Example:

```html
<form
  class="waitlist-form"
  id="waitlist-form"
  data-form-endpoint="https://formspree.io/f/your-form-id"
  novalidate
>
```

## Local preview

You can preview locally with any static server. For example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
