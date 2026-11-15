import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import ClientSignIn from "./ClientSignIn";

test("stashes Thumbtack customer id before create account", () => {
  const onFindLead = vi.fn();
  const onSignUp = vi.fn();
  render(
    <ClientSignIn
      onSignIn={vi.fn()}
      onSignUp={onSignUp}
      onFindLead={onFindLead}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /^create account$/i }));
  fireEvent.change(screen.getByLabelText(/customer id/i), {
    target: { value: "521561969212661774" },
  });
  fireEvent.change(screen.getByLabelText(/^email$/i), {
    target: { value: "a@b.com" },
  });
  fireEvent.change(screen.getByLabelText(/^password$/i), {
    target: { value: "secret1" },
  });
  const createButtons = screen.getAllByRole("button", { name: /^create account$/i });
  fireEvent.click(createButtons.at(-1));

  expect(onFindLead).toHaveBeenCalledWith({
    thumbtackCustomerId: "521561969212661774",
  });
  expect(onSignUp).toHaveBeenCalledWith("a@b.com", "secret1");
});

test("hides Thumbtack field on sign in", () => {
  render(
    <ClientSignIn
      onSignIn={vi.fn()}
      onSignUp={vi.fn()}
      onFindLead={vi.fn()}
    />,
  );

  expect(screen.queryByLabelText(/customer id/i)).toBeNull();
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

test("can open directly in create account mode", () => {
  render(
    <ClientSignIn
      initialMode="signup"
      onSignIn={vi.fn()}
      onSignUp={vi.fn()}
    />,
  );

  expect(screen.getAllByRole("button", { name: /create account/i })).toHaveLength(2);
  expect(screen.getAllByRole("button", { name: /^sign in$/i })).toHaveLength(1);
});

test("does not show or dividers between auth buttons", () => {
  render(
    <ClientSignIn
      onSignIn={vi.fn()}
      onSignUp={vi.fn()}
      onGoogleSignIn={vi.fn()}
      onContinueAsGuest={vi.fn()}
    />,
  );

  expect(screen.queryByText(/^or$/i)).toBeNull();
});
