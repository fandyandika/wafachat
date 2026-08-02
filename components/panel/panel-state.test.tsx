import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { PanelState } from "./panel-state";

(globalThis as any).React = React;

test("error state is announced and empty state remains instructional", () => {
  const error = renderToStaticMarkup(
    <PanelState kind="error" title="Data gagal dimuat" description="Periksa koneksi." action={<button>Coba lagi</button>} />,
  );
  const empty = renderToStaticMarkup(
    <PanelState kind="empty" title="Belum ada data" description="Pilih periode untuk mulai." />,
  );

  expect(error).toContain('role="alert"');
  expect(error).toContain("Coba lagi");
  expect(empty).not.toContain('role="alert"');
  expect(empty).toContain("Pilih periode untuk mulai");
});
