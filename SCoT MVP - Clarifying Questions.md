# SCoT Colony Management App — Clarifying Questions

**For:** Street Cats of Tavira
**From:** Volunteer Developer
**Re:** MVP Requirements v1.0 — open questions before development begins

---

Thank you for the requirements document — it's clear and well thought through. Before we start building, there are some details that will affect either the architecture or the scope of the MVP. The questions below are grouped by topic. The first section ("Priority") are the ones we'd like answered before any code is written; the rest can be answered as we go.

---

## Priority — please answer before development starts

1. **Sign-up flow.** Should Feeders be able to register themselves, or must an Admin/Caretaker invite them by email?

2. **Offline support.** How reliable is mobile signal at the colonies? Does the app need to work fully offline (with later sync), or is "needs a connection" acceptable for the MVP?

3. **Multi-organisation timeline.** Is expanding to other organisations a real goal within the next 12 months, or a longer-term aspiration? This affects how strictly we separate organisation data from day one.

4. **Incident urgency levels.** How many tiers do you want (e.g., Low / Medium / High / Emergency, or simply Urgent vs. Not urgent)? Which levels should trigger an immediate notification vs. just appear on the dashboard?

5. **Notification channels.** Is email sufficient for the MVP, or do you also need push notifications / SMS for urgent incidents?

6. **Language.** Does the MVP need to launch in Portuguese, English, or both?

7. **Wix boundary.** Should the public Wix site display any data from the app (total cats helped, colony count, adoptable cats gallery), or are the two completely independent?

8. **GDPR — departing volunteers.** If a volunteer leaves, do you need to fully delete their account and personal data, or simply deactivate it? Should their past feeding updates remain visible (attributed to "former volunteer") or be removed?

---

## Accounts & access

9. Who can promote or change a user's role (e.g., turn a Feeder into a Caretaker)?

10. Should Caretakers see all colonies in their organisation, or only ones they are personally assigned to?

11. Can one person hold different roles in different organisations (once multi-org launches), or is each user limited to one role?

## Photos & media

12. Roughly how many photos do you expect per cat, and per incident? (Affects storage costs.)

13. Any preferred size or quality, or should the app automatically compress photos on upload?

14. Should older photos ever be auto-deleted, or kept indefinitely?

## Alert thresholds

15. **"Cat not seen recently"** on the dashboard — what counts as "recently"? 3 days? 7 days? 14 days?

16. **"Repeated not-seen reports"** alert — how many consecutive reports should trigger it, and over what time window?

17. **"Feeding missed"** alert — how long after the scheduled feeding window before this fires?

## Incidents

18. Who is allowed to close or resolve an incident — only Caretakers and Admins, or also the Feeder who reported it?

## Notifications

19. Should Caretakers be able to mute or configure their own alerts, or is alerting configured organisation-wide?

## Data, privacy & history

20. Do you need an audit trail — i.e., the ability to see who edited a cat record, who marked a cat as missing, or who closed an incident?

21. Do you need to export data (e.g., CSV of cats, feeding history) for reporting or grant applications?

## Multi-organisation & cat history

22. If a cat moves between colonies (e.g., relocated), should the system retain its history under the same record, or treat it as a new cat?

## Wix integration details

23. Where should users land after logging in — a subdomain like `app.streetcatsoftavira.org`, or a path on the existing Wix site?

---

*Once we have answers to the Priority section, we can finalise the technical plan and begin development. The remaining questions can be answered alongside the build.*
