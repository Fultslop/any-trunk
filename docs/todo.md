TODO 
====

Short list of open items, not spec ready.

## Add ESLint

To get the strictest possible environment, the best approach is to **layer them**. You don't have to choose one or the other; they are designed to complement each other.

Think of it like building a security system: **Airbnb** handles the structural integrity and common mistakes, while **Unicorn** adds a layer of advanced, modern "opinionated" rules that Airbnb doesn't cover.

---

## The Recommended "Power User" Setup
The most robust way to set this up is to use Airbnb as your **base** and Unicorn as your **enhancement**.

### 1. Installation
You’ll need to install both the Airbnb config and the Unicorn plugin:
```bash
npx install-peerdeps --dev eslint-config-airbnb-base
npm install --save-dev eslint-plugin-unicorn
```

### 2. Configuration (`.eslintrc.json`)
In your configuration file, you "extend" both. The order matters: put the more specific or "opinionated" ones last so they can override the base if there’s a conflict.

```json
{
  "extends": [
    "airbnb-base",
    "plugin:unicorn/recommended"
  ],
  "rules": {
    // You can manually tweak rules here if they are too annoying
    "unicorn/prevent-abbreviations": "warn" 
  }
}
```

---

## Why use both?

| Feature | Airbnb (The Base) | Unicorn (The Add-on) |
| :--- | :--- | :--- |
| **Focus** | Eliminating bugs and enforcing style. | Modernizing code and "clean code" patterns. |
| **Strictness** | Forbids `var`, requires semicolons. | Forbids `Array.from()` if `[...]` works. |
| **Examples** | Prevents reassigning function params. | Prefers `node.remove()` over `parent.removeChild(node)`. |

### Is there any downside?
The only real "risk" is **Rule Friction**. Occasionally, Unicorn might suggest a very modern ES6+ pattern that Airbnb hasn't officially adopted yet. 

**The Fix:** If they ever clash, your ESLint output will tell you exactly which rule is complaining. You can then simply go into your `rules` object in `.eslintrc.json` and set the one you dislike to `"off"`.

### My Verdict
If you truly want the highest level of code quality, **install both.** Airbnb gives you the professional-grade foundation, and Unicorn ensures you are using the most "bleeding edge" and readable JavaScript features available in ES6+.
## Scav hunt

* + Make sure we write this as a template, other devs can easily lift and 
    implement in their project. Therefore lean towards industry standards, reduce
    homebrew code as much as possible
* + How do we know what github / drive folder to look for, we can't just scan all ? Do we create one master hunt project / folder wtih locations underneath ? How do ensure a unique naming strat ?
* + Have a link to the drive / github at all time on screen.
* + Invite collaborators (read.write data, can't close delete project)
* + Members overview Approve collabs/participatns

* x Import groups (collabs/particpants) from whatasapp ... 
  No need just send link in the group



## Plan after scav hunt

* Expand with one more backing - we have google drive / github / drop box ? <- show step by step how to do your own, drop box as an example (ownCloud.online, Box.com "External Collaborators" + Auto-Delete, Proton Drive (Privacy-First BYOS))
* Evaluate other potential services for future, give listing / rating
* Figure out how to run the cloudflare stack equivalent locally. Local server, expose on the web  + new demo
* Add fallback service to local, keep in sync, refill once back up

