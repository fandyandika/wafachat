import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"

import { MetricCard } from "./metric-card"
import { Button, buttonVariants } from "./button"

(globalThis as any).React = React

test("button variants keep 44px mobile touch targets", () => {
  expect(buttonVariants({ size: "xs" })).toContain("h-11")
  expect(buttonVariants({ size: "icon" })).toContain("size-11")
  expect(buttonVariants({ size: "icon-xs" })).toContain("size-11")
  expect(buttonVariants({ size: "icon-sm" })).toContain("size-11")
  expect(buttonVariants({ size: "icon-lg" })).toContain("size-11")

  const button = renderToStaticMarkup(<Button size="xs" className="h-6">Compact</Button>)
  expect(button).toContain("h-11")
  expect(button).not.toMatch(/\sh-6(?:\s|")/)
})

test("interactive primitives suppress motion-reduction transitions", () => {
  const button = renderToStaticMarkup(<Button>Save</Button>)
  const metric = renderToStaticMarkup(<MetricCard label="Leads" value="42" />)

  expect(button).toContain("motion-reduce:transition-none")
  expect(metric).toContain("motion-reduce:transition-none")
})
