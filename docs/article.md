# Fast AI Agents in a Browser Tab

*Interface lifting with an on-device model: no server, no API key, nothing to install.*

Live demo: https://vishalmysore.github.io/liftKaraDe/ · Code: https://github.com/vishalmysore/liftKaraDe

> Inspired by Fareed Khan's article
> [Building Fast Computer Agents to Solve Complex Tasks](https://medium.com/@fareedkhandev/cf2bda5c54e7)
> and his open-source [ai-pc](https://github.com/FareedKhan-dev/ai-pc) project, which introduced me to interface
> lifting. This post takes that idea into the browser.

## The problem

AI agents that use a computer usually work the way a person does. They look at a screenshot, decide where to click,
click, wait, and look again. Every click is a call to a large model with a large picture attached.

That has three costs:

- **It is slow.** A task with 40 clicks is 40 model calls, one after another.
- **It is expensive.** Each screenshot costs thousands of tokens.
- **It is fragile.** All 40 clicks have to land correctly, and a screenshot cannot prove the result is right.

Now try to run that agent on a small model inside a browser, on a laptop's own graphics card. A single model call
takes several seconds. Forty of them is not slow, it is unusable. So if we want private, free, on-device agents, we
need a design that asks the model far less.

## The idea: interface lifting

Most work a program does ends up as a file, and a file can be created by code. A Photoshop poster is a `.psd` file.
An AutoCAD drawing is a `.dxf` file. Neither needs anyone to click through the program's window.

Interface lifting means giving the model each feature as a **ready-made function** instead of a screen:

- The model reads the request and decides which function to call and with what inputs. That is one decision.
- Code does the whole job and creates the real file.
- The same code checks its own output and reports pass or fail.

The model goes from 40 small decisions ("click here") to one large one ("make a poster with these four layers").

## What this demo does

Lift Kara De is a single web page. You type a request, and a real file comes back that opens in the real program.

1. **Pick the function.** Simple keyword rules look at your sentence. "marla" and "bedrooms" point to the house plan
   function, "photoshop" or "poster" to the poster function. Only the matching function is shown to the model, which
   keeps the prompt tiny.
2. **Fill in the inputs.** For plainly worded requests a pattern match does this instantly, with no model at all.
   Otherwise a small model running in the tab (WebLLM on WebGPU) fills them in, and its answer is forced to follow
   the function's input format, so it is always well formed.
3. **Do the work.** Plain code in the page builds the file.
4. **Check the work.** The function reads its own file back with an independent reader and lists what passed.

Each function is declared the same way: a description the model reads, the inputs it takes, and the code behind it.

```ts
tool({
  name: "draw_house_plan",
  description: "Draw a ground floor plan as a DXF for AutoCAD ...",   // all the model ever sees
  parameters: { type: "object", properties: { plot: { type: "string" }, bedrooms: { type: "integer" } } },
  fn: drawHousePlan,   // does the work and returns its own checks
  rules,               // fills the inputs from the sentence when it can, with no model
});
```

## Example 1: a layered Photoshop poster

Request: *"photoshop file 1080x1080: background shop.jpg; logo logo.png top-left; title 'Eid Sale' white; subtitle
'20% off' yellow"*

The page writes a real PSD, byte by byte, with four named layers that stay movable in Photoshop, GIMP or Photopea.
Then it reopens the file with a separate PSD reader and confirms that every layer is there, in the right place, and
that the flattened picture matches the layers stacked.

![The Eid Sale poster as a 4-layer PSD, with its checks](img/poster.png)

By hand, or by a screen agent, this is about 40 actions. Here it is one function call.

## Example 2: a house plan for AutoCAD

Request: *"a 10 marla house with 3 bedrooms"*

A 10 marla plot is 35 by 65 feet. The function tries 6,000 room layouts, scores each one (room sizes, daylight,
whether every room can be reached through a door), keeps the best, and writes it as an AutoCAD drawing in true
units. It then reads the drawing back and runs 18 checks. The whole thing takes about 40 milliseconds.

![A 10 marla house plan, checked 18 of 18](img/house-plan.png)

## A clear "no" instead of a wrong answer

Ask for the same house at a scale of 1:100 and the plan will not fit on the sheet. The function does not draw
something wrong. It refuses, explains why, and says what would work.

![The function refuses 1:100 and names the scale that fits](img/refusal.png)

## Why the checks matter

Small models make mistakes, and that is exactly why each function checks its own output.

In one run, a 1.5 billion parameter model was asked for the four-layer poster and left the logo out. The file it
produced was a perfectly valid PSD. But one of the checks compares the result with the request, and it failed: the
request named `logo.png`, and no layer used it. The result came back as 4 of 5, with the reason.

![The model drops the logo, and the check catches it](img/model-run.jpg)

This is what makes a small on-device model usable for real work. It does not have to be right every time, because
the mistake is caught at the step that made it, and reported in plain words.

## The numbers

Measured in a browser tab on a laptop's integrated graphics:

| Task | Model calls | Time | Checks |
|---|---|---|---|
| House plan, inputs filled by rules | 0 | 0.04 s | 18/18 |
| Poster, inputs filled by rules | 0 | 0.1 to 1.1 s | 5/5 |
| House plan, inputs filled by the on-device model | 1 | about 8 s | 18/18 |
| Poster, inputs filled by the on-device model | 1 | about 36 s | 4/5 |

The work itself takes milliseconds. Nearly all the time is the model thinking, so the fastest design is the one that
asks the model the least: at most once per task, and not at all when the request is clear.

## Where this is useful

- **Private by design.** The model and the files stay on your machine. Nothing is uploaded, which matters for
  client designs, financial sheets or anything confidential.
- **Free to run.** There is no API bill and no server to maintain. The page is static and can be hosted anywhere.
- **Nothing to install.** A link is enough. It works on any laptop with a modern browser.
- **Trustworthy output.** Every result arrives with the checks it passed, so you know what was verified.
- **A pattern you can reuse.** Any task that ends in a file fits: invoices, spreadsheets, slide decks, SVG graphics,
  calendar files, subtitles, video timelines. Write the function and its checks once, and a small model can use it.

## Limits

- The files are verified by independent readers in the browser, not by Photoshop or AutoCAD themselves.
- A browser cannot drive programs installed on your computer. It can only create the files they open.
- The house layout is a simple band design, good for a first draft, not a replacement for an architect.
- Very small models struggle with long, nested inputs. Larger ones in the model picker should do better.

## What comes next

Chaining functions together from one sentence (draw the plan, then render it in 3D), an approval step before
anything is shared, and learned shortcuts that replay a task with no model call at all.

## Try it

Open the [live demo](https://vishalmysore.github.io/liftKaraDe/) and click any example. They run immediately. To
watch a model fill in the inputs, load one (the weights download once) and untick "Rules first".

Thanks to Fareed Khan for the original article and for sharing the code behind it.
