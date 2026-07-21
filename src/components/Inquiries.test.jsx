import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import Inquiries from "./Inquiries";

test("lists inquiries, opens details, and marks a new inquiry reviewed", async () => {
  const markInquiryReviewed = vi.fn().mockResolvedValue();
  render(
    <Inquiries
      ctx={{
        inquiries: [
          {
            id: "inquiry-1",
            category: "handyman",
            name: "Jamie",
            email: "jamie@example.com",
            phone: "555-0100",
            address: "12 Main St",
            description: "Repair a loose exterior handrail and repaint it.",
            preferredTiming: "Next week",
            status: "new",
          },
        ],
        markInquiryReviewed,
      }}
    />
  );

  expect(screen.getByText("Jamie")).toBeInTheDocument();
  expect(screen.getByText(/Repair a loose exterior/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /Jamie/ }));
  expect(screen.getByText("jamie@example.com")).toBeInTheDocument();
  expect(screen.getByText("Next week")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
  await waitFor(() => expect(markInquiryReviewed).toHaveBeenCalledWith("inquiry-1"));
});
