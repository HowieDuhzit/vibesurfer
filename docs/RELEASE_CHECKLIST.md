# Release Checklist

1. Run `npm run lint`
2. Run `npm run test`
3. Run `npm run build`
4. Verify local gameplay:
   - Load song / play works
   - Notes spawn and score updates
   - Practice loop + speed works
   - Endless mode spawns from live beats
   - Mobile touch lane controls work
5. Confirm CI is green on `master`
6. Update `CHANGELOG.md`
7. Tag release version and publish notes
