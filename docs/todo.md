TODO 
====

Short list of open items, not spec ready.

1) Implement The 'Abstract Class Pattern', ie implement over the XStores.

```js
class ShapeInterface {
  constructor() {
    if (this.constructor === ShapeInterface) {
      throw new Error("Object of Abstract Class cannot be created");
    }
  }

  getArea() {
    throw new Error("Method 'getArea()' must be implemented.");
  }
}

class Circle extends ShapeInterface {
  constructor(radius) {
    super();
    this.radius = radius;
  }

  getArea() {
    return Math.PI * Math.pow(this.radius, 2);
  }
}
```

## Plan after scav hunt

* Expand with one more backing - we have google drive / github / drop box ? <- show step by step how to do your own, drop box as an example (ownCloud.online, Box.com "External Collaborators" + Auto-Delete, Proton Drive (Privacy-First BYOS))
* Evaluate other potential services for future, give listing / rating
* Figure out how to run the cloudflare stack equivalent locally. Local server, expose on the web  + new demo
* Add fallback service to local, keep in sync, refill once back up

