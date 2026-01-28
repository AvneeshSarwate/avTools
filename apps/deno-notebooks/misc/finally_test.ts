function demoFinallyUnhandled() {
  console.log("demo start");

  const p = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("boom")), 0);
  });

  // This runs, but does NOT handle the rejection.
  p.finally(() => console.log("finally ran"));

  // Give the timer a chance to fire.
  setTimeout(() => console.log("demo end"), 10);
}

demoFinallyUnhandled()