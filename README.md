# Saku Saku English Vocabulary

サクサク英単語 is a lightweight vocabulary learning app for Japanese learners of English.

The app is currently kept as a public test build for direct-link testing. The page intentionally uses `noindex,nofollow` and `robots.txt` disallow rules so that it does not become a search-facing public product before the learning content, accessibility, and mobile layout checks are complete.

## Current Focus

- English vocabulary practice for Japanese learners
- British IPA-based pronunciation display
- en_GB / en_US speech comparison where the device supports Web Speech API voices
- Three-choice tests by default
- Streak, star, sprout, and background-colour feedback to encourage repeated practice
- Accessibility improvements for keyboard operation and screen-reader-aware feedback

## Privacy

This app is a static HTML app. It does not send learning progress to a server.

Learning progress and settings are stored locally in the browser using `localStorage`. Users can clear the data from the app settings or by clearing browser site data.

## Development

Open the app locally with a simple static server:

```bash
python3 -m http.server 8791
```

Then open:

```text
http://127.0.0.1:8791/
```

## Public-Test Policy

The current app page is intentionally excluded from search indexing:

- `index.html` includes `noindex,nofollow`
- `robots.txt` contains `Disallow: /`

If this project is later promoted from public test to a search-facing product page, update those files intentionally after a separate release review.

## License

MIT License. See `LICENSE`.
