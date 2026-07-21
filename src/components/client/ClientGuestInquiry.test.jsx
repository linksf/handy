import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import ClientGuestInquiry from "./ClientGuestInquiry";

test("category step offers Handyman Services and Custom Fabrication", () => {
  render(<ClientGuestInquiry />);

  expect(screen.getByRole("button", { name: /handyman services/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /custom fabrication/i })).toBeInTheDocument();
});

test("handyman selection shows handyman-specific fields", () => {
  render(<ClientGuestInquiry />);

  fireEvent.click(screen.getByRole("button", { name: /handyman services/i }));

  expect(screen.getByLabelText(/property type/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/indoor or outdoor/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/urgency/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/rough size or hours estimate/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/access notes/i)).toBeInTheDocument();
});

test("fabrication selection shows fabrication-specific fields", () => {
  render(<ClientGuestInquiry />);

  fireEvent.click(screen.getByRole("button", { name: /custom fabrication/i }));

  expect(screen.getByLabelText(/material preferences/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/dimensions or sketch notes/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/install or pickup/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/finish or style notes/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/deadline/i)).toBeInTheDocument();
});

test("empty description blocks submission", () => {
  const submitInquiry = vi.fn();
  render(<ClientGuestInquiry submitInquiry={submitInquiry} />);

  fireEvent.click(screen.getByRole("button", { name: /handyman services/i }));
  fireEvent.change(screen.getByLabelText(/^name$/i), {
    target: { value: "Jamie Customer" },
  });
  fireEvent.click(screen.getByRole("button", { name: /submit inquiry/i }));

  expect(screen.getByRole("alert")).toHaveTextContent(/describe what you need/i);
  expect(submitInquiry).not.toHaveBeenCalled();
});
