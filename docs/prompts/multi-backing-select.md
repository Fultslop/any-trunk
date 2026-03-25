Multibacking select
===================

The next step is to create an app which allows the organizer to select from ALL supported backings the developer exposes. We have created a potluck and gift example (see `apps\gifts` and `apps\potluck`) which were rather simple. The next app is going to be a little bit more complex in order to demo the abilities of AnyTrunk. 

The App we're going to design is a "scavenger hunt". The workflow in scope for this step is roughly the following:

* An organizer can go the AnyTrunk supported scavenger-hunt app page
* Select a backing (Github or Drive)
* Go through the actviation / onboarding process, ie select a Github/Drive account or create one in case they don't have an account
* Is presented a screen with AnyTrunk scavenger-hunt "spaces" (if any) 
* At the botom of this list (if any) is a "create new hunt" button
* The organizer is taken to the new hunt or selected hunt screen.
* The hunt backing creation (git hub or drive) has a folder where the organizer can add new "objectives" for the hunt. An example of this objectives is the data file 'apps\hunt\data\amsterdam.json'. 
* How the app uses the data is not up to AnyTrunk, AnyTrunk should just provide the means for the app to access this data (read), upload new data (create), update data (update) or delete data. Editing should be possible to do in or using the means provied by - or using the backing itself. Eg in github users should commit files,  in drive they can edit them directly, AnyTrunk should allow the app to be aware of changes.
* The organizer can go back and forth between the different pages as desired  (account selection/hunt selection/hunt editing)
* We will use a graphical library to make this part look somewhat credible, **discuss** what platform to use (eg tailwind).
* We will make the user experience as smooth as possible with as little barriers as possible for the organizer / participant and clear, well written steps for the developer of the app.

We're setting up the scaffolding for the organizer, so out of scope: starting the actual hunt, inviting people, tracking people's progress, ending the hunt, seeing people's score.
