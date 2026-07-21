import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import ClientSignIn from "./ClientSignIn";

test("stashes Thumbtack customer id before sign-in", () => {
  const onFindLead = vi.fn();
  render(
    <ClientSignIn
      onSignIn={vi.fn()}
      onSignUp={vi.fn()}
      onFindLead={onFindLead}
    />,
  );

  fireEvent.change(screen.getByLabelText(/customer id/i), {
    target: { value: "521561969212661774" },
  });
  fireEvent.change(screen.getByLabelText(/^email$/i), {
    target: { value: "a@b.com" },
  });
  fireEvent.change(screen.getByLabelText(/^password$/i), {
    target: { value: "secret1" },
  });
  const signInButtons = screen.getAllByRole("button", { name: /^sign in$/i });
  fireEvent.click(signInButtons.at(-1));

  expect(onFindLead).toHaveBeenCalledWith({
    thumbtackCustomerId: "521561969212661774",
  });
});

test("shows continue as guest", () => {
  const onContinueAsGuest = vi.fn();
  render(
    <ClientSignIn
      onSignIn={vi.fn()}
      onSignUp={vi.fn()}
      onContinueAsGuest={onContinueAsGuest}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /continue as guest/i }));

  expect(onContinueAsGuest).toHaveBeenCalled();
});
