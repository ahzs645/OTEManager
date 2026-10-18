// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Window } from "happy-dom";
import { executeBankAction as injectedBankAction } from "../extensions/vancity-payment-helper/bank.js";

async function runBankAction(...args: any[]) {
  const task = injectedBankAction(...args);
  await vi.advanceTimersByTimeAsync(15000);
  return task;
}

async function executeBankAction(
  action: string,
  payment: any,
  message: string,
) {
  const result = await runBankAction(action, payment, message);
  if (result.status === "error") throw new Error(result.message);
  return result;
}

let window: Window;
const payment = {
  recipientName: "Test Writer",
  recipientEmail: "writer@example.test",
  amountCents: 4500,
};
const message =
  "Over The Edge: Campus news — Tier 2 $35.00 + Research bonus $10.00";
beforeEach(() => {
  window = new Window({ url: "https://my.vancity.com/banking/test-fixture" });
  vi.useFakeTimers();
  for (const key of [
    "document",
    "location",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "Event",
  ])
    vi.stubGlobal(key, (window as any)[key]);
  vi.stubGlobal("getComputedStyle", window.getComputedStyle.bind(window));
  // happy-dom has no layout; simulate whether fixture controls are rendered.
  vi.spyOn(window.Element.prototype, "getClientRects").mockImplementation(
    function (this: any) {
      return !this.isConnected || this.hidden || this.style.display === "none"
        ? ([] as any)
        : ([{ width: 100, height: 20 }] as any);
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.happyDOM.abort();
});
function html(value: string) {
  window.document.body.innerHTML = `<box role="main">${value.replaceAll("<h1>", '<box role="heading" aria-level="1">').replaceAll("</h1>", "</box>")}</box>`;
}
function value(id: string) {
  return (window.document.getElementById(id) as any).value;
}
function sendForm(email = payment.recipientEmail, amount = "0.00") {
  html(
    `<h1>Send money</h1><input id="RetailEtransfer_contactEmailId_input" value="${email}"><input type="radio" id="RetailEtransfer_notificationPreference_input_E-input" checked><input id="RetailEtransfer_paymentAmount_input" value="${amount}"><textarea id="RetailEtransfer_remarks_input" maxlength="400"></textarea><input hidden id="RetailEtransfer_securityAnswer_input" value="secret"><button>Continue</button><button>Send</button>`,
  );
}
function contacts(rows: string) {
  html(
    `<h1>Send money</h1><input aria-label="Search by name, email or mobile number.">${rows}<button>Add contact</button><button>Continue</button><button>Send</button>`,
  );
}
function row(email: string, name = "A different display name") {
  return `<box class="contact-virtual-row" role="button"><span class="name">${name}</span><span class="accountNumber">${email}</span></box>`;
}
async function action(name: string) {
  const task = executeBankAction(name, payment, message);
  task.catch(() => {}); // Attach before advancing time; the caller asserts rejected actions.
  return task;
}

test("fills exact saved amount and message, leaving Continue/Send and security answers untouched", async () => {
  sendForm();
  const clicks = [...window.document.querySelectorAll("button")].map((b) =>
    vi.spyOn(b, "click"),
  );
  const input = window.document.getElementById(
    "RetailEtransfer_paymentAmount_input",
  )!;
  const changed = vi.fn();
  input.addEventListener("input", changed);
  expect(
    (await executeBankAction("fill-payment", payment, message)).status,
  ).toBe("filled");
  expect(value("RetailEtransfer_paymentAmount_input")).toBe("45.00");
  expect(value("RetailEtransfer_remarks_input")).toBe(message);
  expect(value("RetailEtransfer_securityAnswer_input")).toBe("secret");
  expect(changed).toHaveBeenCalledOnce();
  clicks.forEach((click) => expect(click).not.toHaveBeenCalled());
});

test("wrong recipient blocks every payment write", async () => {
  sendForm("someone-else@example.test");
  await expect(
    executeBankAction("fill-payment", payment, message),
  ).rejects.toThrow("does not match");
  expect(value("RetailEtransfer_paymentAmount_input")).toBe("0.00");
  expect(value("RetailEtransfer_remarks_input")).toBe("");
});

function paymentReview(
  email = payment.recipientEmail,
  amount = "45.00",
  note = message,
) {
  html(
    `<h1>Send money</h1><h2>Review</h2><span>${email}</span><div role="group" class="display-field"><span class="label" aria-hidden="true">Amount</span><span class="value">${amount}</span></div><p>${note}</p><button>Confirm</button>`,
  );
}

test("leaves only the matching recorded send receipt and returns to contacts without payment confirmation", async () => {
  paymentReview();
  const confirm = vi.spyOn(window.document.querySelector("button")!, "click");
  const reference = "20260102030405000001";
  const dialog = window.document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.innerHTML = `<box class="ETRANSFERSENDMONEY success"><box class="confirmation-description-text" aria-label="Your transfer has been sent."></box></box><button>Back to e-Transfers</button>`;
  for (const [label, text] of Object.entries({
    "Reference #": reference,
    "Email address": payment.recipientEmail,
    Message: message,
  })) {
    const row = window.document.createElement(
      "app-display-label-value-control",
    );
    row.innerHTML = `<mat-label aria-label="${label}"></mat-label><fpx-display-text></fpx-display-text>`;
    row.querySelector("fpx-display-text")!.textContent = text;
    dialog.querySelector(".success")!.append(row);
  }
  window.document.body.append(dialog);
  const back = vi.spyOn(dialog.querySelector("button")!, "click");
  dialog
    .querySelector("button")!
    .addEventListener("click", () => contacts(row(payment.recipientEmail)));
  const recorded = {
    reference,
    recipientEmail: payment.recipientEmail,
    message,
  };
  expect(
    (
      await runBankAction("leave-recorded-receipt", null, "", null, null, {
        ...recorded,
        reference: "20260102030405000002",
      })
    ).status,
  ).toBe("error");
  expect(back).not.toHaveBeenCalled();
  expect(
    (
      await runBankAction(
        "leave-recorded-receipt",
        null,
        "",
        null,
        null,
        recorded,
      )
    ).status,
  ).toBe("navigated");
  expect(back).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();
});

test("next preparation cannot discard another payment form or an unrecorded Review", async () => {
  const receipt = {
    reference: "20260102030405000001",
    recipientEmail: payment.recipientEmail,
    message,
  };
  sendForm();
  expect(
    (
      await runBankAction(
        "leave-recorded-receipt",
        null,
        "",
        null,
        null,
        receipt,
      )
    ).status,
  ).toBe("error");
  paymentReview();
  const confirm = vi.spyOn(window.document.querySelector("button")!, "click");
  expect(
    (
      await runBankAction(
        "leave-recorded-receipt",
        null,
        "",
        null,
        null,
        receipt,
      )
    ).status,
  ).toBe("error");
  expect(confirm).not.toHaveBeenCalled();
});

test("opens matching Review from a verified form and never clicks final Confirm", async () => {
  sendForm(payment.recipientEmail, "45.00");
  (
    window.document.getElementById("RetailEtransfer_remarks_input") as any
  ).value = message;
  let finalConfirms = 0;
  const next = window.document.querySelector("button")!;
  const continued = vi.spyOn(next, "click");
  next.addEventListener("click", () => {
    paymentReview();
    window.document
      .querySelector("button")!
      .addEventListener("click", () => finalConfirms++);
  });
  expect((await action("open-review")).status).toBe("reviewed");
  expect(continued).toHaveBeenCalledOnce();
  expect(finalConfirms).toBe(0);
  expect((await action("open-review")).status).toBe("reviewed");
  expect(finalConfirms).toBe(0);
});

test("recognizes Vancity Review while cached editable form widgets remain rendered, without accepting their values as review evidence", async () => {
  paymentReview(payment.recipientEmail, "$45.00");
  const main = window.document.querySelector('[role="main"]')!;
  main.insertAdjacentHTML(
    "beforeend",
    `<input id="RetailEtransfer_paymentAmount_input" value="45.00"><textarea id="RetailEtransfer_remarks_input">${message}</textarea><input id="RetailEtransfer_contactEmailId_input" value="${payment.recipientEmail}">`,
  );
  const confirm = vi.spyOn(window.document.querySelector("button")!, "click");
  expect((await action("open-review")).status).toBe("reviewed");
  expect(confirm).not.toHaveBeenCalled();
  const note = main.querySelector("p")!;
  note.textContent = "A different article";
  await expect(action("open-review")).rejects.toThrow("Review does not match");
  expect(confirm).not.toHaveBeenCalled();
});

test("reads the live Review amount with its nested currency symbol and ignores unrelated matching values", async () => {
  paymentReview(payment.recipientEmail, "<em>$</em> 45.00 ");
  const main = window.document.querySelector('[role="main"]')!;
  const amount = main.querySelector(".display-field .value")!;
  main.insertAdjacentHTML(
    "beforeend",
    `<div role="group" class="display-field"><span class="label">Service fee</span><span class="value"><em>$</em> 45.00</span></div><input readonly id="RetailEtransfer_paymentAmount_input" value="45.00"><span>45.00</span>`,
  );
  const confirm = vi.spyOn(window.document.querySelector("button")!, "click");
  expect((await action("open-review")).status).toBe("reviewed");
  amount.innerHTML = "<em>$</em> 46.00";
  await expect(action("open-review")).rejects.toThrow("Review does not match");
  amount.parentElement!.remove();
  await expect(action("open-review")).rejects.toThrow("Review does not match");
  expect(confirm).not.toHaveBeenCalled();
});

test("ambiguous Amount rows and changed displayed fields cannot use cached values to pass Review", async () => {
  paymentReview();
  const main = window.document.querySelector('[role="main"]')!;
  main.insertAdjacentHTML(
    "beforeend",
    `<div class="fpx-field-content"><input readonly id="RetailEtransfer_contactEmailId_input" value="${payment.recipientEmail}"><span class="fpx-readonly-text">wrong@example.test</span></div>`,
  );
  const confirm = vi.spyOn(window.document.querySelector("button")!, "click");
  await expect(action("open-review")).rejects.toThrow("Review does not match");
  main.querySelector(".fpx-readonly-text")!.textContent =
    payment.recipientEmail;
  expect((await action("open-review")).status).toBe("reviewed");
  main.append(main.querySelector(".display-field")!.cloneNode(true));
  await expect(action("open-review")).rejects.toThrow("Review does not match");
  expect(confirm).not.toHaveBeenCalled();
});

test.each(["email", "amount", "message"])(
  "rejects a Review with a changed %s without confirming",
  async (changed) => {
    paymentReview(
      changed === "email" ? "wrong@example.test" : payment.recipientEmail,
      changed === "amount" ? "46.00" : "45.00",
      changed === "message" ? "Other article" : message,
    );
    const confirmed = vi.spyOn(
      window.document.querySelector("button")!,
      "click",
    );
    await expect(action("open-review")).rejects.toThrow(
      "Review does not match",
    );
    expect(confirmed).not.toHaveBeenCalled();
  },
);

test("an incomplete form or contact review cannot advance a payment", async () => {
  sendForm();
  const continued = vi.spyOn(window.document.querySelector("button")!, "click");
  await expect(action("open-review")).rejects.toThrow("not fully prepared");
  expect(continued).not.toHaveBeenCalled();
  html(
    `<h1>Add contact</h1><h2>Review</h2><span>${payment.recipientEmail}</span><button>Confirm</button>`,
  );
  const confirmed = vi.spyOn(window.document.querySelector("button")!, "click");
  await expect(action("open-review")).rejects.toThrow("prepared Send money");
  expect(confirmed).not.toHaveBeenCalled();
});

test("existing amount, long message, missing/readonly fields and wrong method block filling", async () => {
  sendForm(payment.recipientEmail, "99.00");
  await expect(
    executeBankAction("fill-payment", payment, message),
  ).rejects.toThrow("different amount");
  sendForm();
  await expect(
    executeBankAction("fill-payment", payment, "x".repeat(401)),
  ).rejects.toThrow("1–400");
  expect(value("RetailEtransfer_paymentAmount_input")).toBe("0.00");
  window.document.getElementById("RetailEtransfer_remarks_input")!.remove();
  await expect(
    executeBankAction("fill-payment", payment, message),
  ).rejects.toThrow("unavailable");
  expect(value("RetailEtransfer_paymentAmount_input")).toBe("0.00");
  sendForm();
  (
    window.document.getElementById("RetailEtransfer_paymentAmount_input") as any
  ).readOnly = true;
  await expect(
    executeBankAction("fill-payment", payment, message),
  ).rejects.toThrow("unavailable");
  sendForm();
  (
    window.document.getElementById(
      "RetailEtransfer_notificationPreference_input_E-input",
    ) as any
  ).checked = false;
  await expect(
    executeBankAction("fill-payment", payment, message),
  ).rejects.toThrow("notification method");
});

test("only exact emails match regardless of the contact's display name", async () => {
  contacts(row("WRITER@example.test"));
  expect((await action("search")).status).toBe("matched");
  const contact = window.document.querySelector(".contact-virtual-row")!;
  const clicked = vi
    .spyOn(contact as any, "click")
    .mockImplementation(() => sendForm());
  await action("open-contact");
  expect(clicked).toHaveBeenCalledOnce();
});

test("ambiguous matches and unfiltered results prevent automatic selection", async () => {
  contacts(row(payment.recipientEmail) + row(payment.recipientEmail));
  expect((await action("search")).status).toBe("ambiguous");
  const task = expect(action("open-contact")).rejects.toThrow("Only one exact");
  await task;
  contacts(row("other@example.test", payment.recipientName));
  await expect(action("search")).rejects.toThrow("unrelated results");
});

test("does not add another contact if an exact email match exists", async () => {
  contacts(row(payment.recipientEmail));
  const clicked = vi.spyOn(window.document.querySelector("button")!, "click");
  await expect(action("add-contact")).rejects.toThrow("already exists");
  expect(clicked).not.toHaveBeenCalled();
});

test("requires an explicit settled no-result state before offering to add a contact", async () => {
  contacts("");
  await expect(action("add-contact")).rejects.toThrow("has not confirmed");
  contacts(
    '<box role="status"><box id="no-result-title">Contact not found</box></box>',
  );
  const clicked = vi.spyOn(window.document.querySelector("button")!, "click");
  expect((await action("search")).status).toBe("no-match");
  clicked.mockImplementation(() => contactForm());
  await action("add-contact");
  expect(clicked).toHaveBeenCalledOnce();
});

function contactForm() {
  html(
    `<h1>Add contact</h1><input id="RetailEtransfercontactlogForm_firstName_input" maxlength="35"><input id="RetailEtransfercontactlogForm_emailId_input" maxlength="64"><input type="radio" id="RetailEtransfercontactlogForm_notificationPreference_input_E-input" checked><input hidden id="RetailEtransfercontactlogForm_securityAnswer_input"><button>Continue</button>`,
  );
}

test("fills only contact name/email and validates lengths before writing", async () => {
  contactForm();
  await expect(
    executeBankAction(
      "fill-contact",
      { ...payment, recipientName: "x".repeat(36) },
      message,
    ),
  ).rejects.toThrow("35-character");
  expect(value("RetailEtransfercontactlogForm_emailId_input")).toBe("");
  const click = vi.spyOn(window.document.querySelector("button")!, "click");
  await action("fill-contact");
  expect(value("RetailEtransfercontactlogForm_firstName_input")).toBe(
    payment.recipientName,
  );
  expect(value("RetailEtransfercontactlogForm_emailId_input")).toBe(
    payment.recipientEmail,
  );
  expect(value("RetailEtransfercontactlogForm_securityAnswer_input")).toBe("");
  expect(click).not.toHaveBeenCalled();
});

test("auto-navigates Home through custom e-Transfers and Send money controls", async () => {
  html("<h1>Home</h1>");
  const nav = window.document.createElement("box");
  nav.setAttribute("role", "menuitem");
  nav.setAttribute("aria-label", "e-Transfers");
  window.document.body.prepend(nav);
  nav.addEventListener("click", () => {
    window.document.querySelector('[role="main"]')!.innerHTML =
      '<box role="button" aria-label="Send money 1 of 6">Send money</box>';
    window.document
      .querySelector('[role="button"]')!
      .addEventListener("click", () => contacts(row(payment.recipientEmail)));
  });
  expect((await action("navigate")).status).toBe("navigated");
  expect(
    window.document.querySelector(
      'input[aria-label="Search by name, email or mobile number."]',
    ),
  ).toBeTruthy();
});

test("one-click prepare checks existing email, opens its form and fills payment without sending", async () => {
  contacts(row(payment.recipientEmail));
  window.document
    .querySelector("box.contact-virtual-row")!
    .addEventListener("click", () => sendForm());
  expect((await action("prepare")).status).toBe("filled");
  expect(value("RetailEtransfer_paymentAmount_input")).toBe("45.00");
  expect(value("RetailEtransfer_remarks_input")).toBe(message);
});

test("one-click prepare opens and fills a missing contact, without saving it", async () => {
  contacts(
    '<box role="status"><box id="no-result-title">Contact not found</box></box>',
  );
  window.document
    .querySelector("button")!
    .addEventListener("click", contactForm);
  expect((await action("prepare")).status).toBe("contact-filled");
  expect(value("RetailEtransfercontactlogForm_emailId_input")).toBe(
    payment.recipientEmail,
  );
  expect(window.document.querySelector("button")!.textContent).toBe("Continue");
});

test.each([
  ["prepare", "filled", 1, 0],
  ["ensure-contact", "created", 0, 0],
  ["ensure-contact", "created", 0, 1],
  ["ensure-contact", "created", 0, 2],
])(
  "%s saves a real missing contact, verifies it, and only opens a payment when requested",
  async (actionName, expectedStatus, expectedOpens, conflictingNames) => {
    const realPayment = { ...payment, recipientEmail: "writer@campus.ca" };
    let contactContinues = 0,
      contactConfirms = 0,
      successPopupDismissals = 0,
      emailChecks = 0,
      paymentContinues = 0,
      paymentSends = 0,
      paymentOpens = 0;
    contacts(
      '<box role="status"><box id="no-result-title">Contact not found</box></box>',
    );
    window.document
      .querySelector("input")!
      .addEventListener("input", () => emailChecks++);
    window.document.querySelector("button")!.addEventListener("click", () => {
      contactForm();
      const nameField = window.document.getElementById(
        "RetailEtransfercontactlogForm_firstName_input",
      )! as any;
      const continueButton = window.document.querySelector("button")!;
      nameField.addEventListener("input", () => {
        window.document.getElementById("duplicate-name-error")?.remove();
        const conflict =
          conflictingNames > 0 &&
          (nameField.value === realPayment.recipientName ||
            (conflictingNames > 1 &&
              nameField.value === `${realPayment.recipientName} 2`));
        continueButton.disabled = conflict;
        if (conflict) {
          nameField.insertAdjacentHTML(
            "afterend",
            '<mat-error id="duplicate-name-error" role="alert">You already have a contact with this name. Please change the contact name.</mat-error>',
          );
        }
      });
      window.document.querySelector("button")!.addEventListener("click", () => {
        contactContinues++;
        const savedContactName = nameField.value;
        html(
          `<app-retail-etransfercontactlog-form><h1>Add contact</h1><span>${savedContactName}</span><button id="fpx-submit-shell-btn">Confirm</button></app-retail-etransfercontactlog-form>`,
        );
        window.document
          .querySelector("button")!
          .addEventListener("click", () => {
            contactConfirms++;
            // The live bank leaves Add contact behind a success dialog outside main.
            window.document.body.insertAdjacentHTML(
              "beforeend",
              '<mat-dialog-container role="dialog"><app-etransfer-confirmation-receipt-form><box role="status">Success! New contact has been added.</box><button>Send money</button><button>Back to e-Transfers</button></app-etransfer-confirmation-receipt-form></mat-dialog-container>',
            );
            const dialog = window.document.querySelector('[role="dialog"]')!;
            const [shortcut, back] = dialog.querySelectorAll("button");
            shortcut.addEventListener("click", () => {
              throw new Error("Use contact lookup first");
            });
            back.addEventListener("click", () => {
              successPopupDismissals++;
              contacts(row(realPayment.recipientEmail));
              window.document
                .querySelector("input")!
                .addEventListener("input", () => emailChecks++);
              window.document
                .querySelector(".contact-virtual-row")!
                .addEventListener("click", () => {
                  paymentOpens++;
                  sendForm(realPayment.recipientEmail);
                  const [next, send] =
                    window.document.querySelectorAll("button");
                  next.addEventListener("click", () => paymentContinues++);
                  send.addEventListener("click", () => paymentSends++);
                });
            });
          });
      });
    });
    const pending = injectedBankAction(actionName, realPayment, message);
    await vi.advanceTimersByTimeAsync(15000);
    expect(await pending).toMatchObject({
      status: expectedStatus,
      contactCreated: true,
      contactName: conflictingNames
        ? `${realPayment.recipientName} ${conflictingNames + 1}`
        : realPayment.recipientName,
    });
    expect(contactContinues).toBe(1);
    expect(contactConfirms).toBe(1);
    expect(successPopupDismissals).toBe(1);
    expect(emailChecks).toBe(2);
    expect(paymentContinues).toBe(0);
    expect(paymentSends).toBe(0);
    expect(paymentOpens).toBe(expectedOpens);
    if (actionName === "prepare")
      expect(value("RetailEtransfer_paymentAmount_input")).toBe("45.00");
    else
      expect(
        window.document.getElementById("RetailEtransfer_paymentAmount_input"),
      ).toBeNull();
  },
);

test("contact-only action rechecks an existing email and never opens its payment", async () => {
  contacts(row(payment.recipientEmail));
  const opened = vi.spyOn(
    window.document.querySelector(".contact-virtual-row")!,
    "click",
  );
  expect((await action("ensure-contact")).status).toBe("matched");
  expect(opened).not.toHaveBeenCalled();
});

test("Prepare resumes a saved-contact success popup by rechecking the email without saving twice", async () => {
  const realPayment = { ...payment, recipientEmail: "writer@campus.ca" };
  html(
    `<h1>Add contact</h1><span>${realPayment.recipientName}</span><button id="fpx-submit-shell-btn">Confirm</button>`,
  );
  const confirm = vi.spyOn(window.document.querySelector("button")!, "click");
  window.document.body.insertAdjacentHTML(
    "beforeend",
    '<mat-dialog-container role="dialog"><app-etransfer-confirmation-receipt-form><box role="status">Success! New contact has been added.</box><button>Back to e-Transfers</button></app-etransfer-confirmation-receipt-form></mat-dialog-container>',
  );
  const back = window.document.querySelector('[role="dialog"] button')!;
  let emailChecked = false;
  back.addEventListener("click", () => {
    contacts(row(realPayment.recipientEmail));
    window.document
      .querySelector("input")!
      .addEventListener("input", () => (emailChecked = true));
    window.document
      .querySelector(".contact-virtual-row")!
      .addEventListener("click", () => sendForm(realPayment.recipientEmail));
  });
  const pending = injectedBankAction("prepare", realPayment, message);
  await vi.advanceTimersByTimeAsync(15000);
  expect((await pending).status).toBe("filled");
  expect(confirm).not.toHaveBeenCalled();
  expect(emailChecked).toBe(true);
  expect(value("RetailEtransfer_paymentAmount_input")).toBe("45.00");
});

test("an unrelated transfer-success dialog is never used as a contact-save receipt", async () => {
  html("<h1>Add contact</h1>");
  window.document.body.insertAdjacentHTML(
    "beforeend",
    '<mat-dialog-container role="dialog"><app-etransfer-confirmation-receipt-form><box role="status">Success! Your transfer has been sent.</box><button>Back to e-Transfers</button></app-etransfer-confirmation-receipt-form></mat-dialog-container>',
  );
  const back = vi.spyOn(
    window.document.querySelector('[role="dialog"] button')! as any,
    "click",
  );
  const pending = injectedBankAction("prepare", payment, message);
  await vi.advanceTimersByTimeAsync(15000);
  expect((await pending).status).toBe("error");
  expect(back).not.toHaveBeenCalled();
});

test("a different visible review email prevents contact confirmation", async () => {
  const realPayment = { ...payment, recipientEmail: "writer@campus.ca" };
  contactForm();
  let confirms = 0;
  window.document.querySelector("button")!.addEventListener("click", () => {
    html(
      `<app-retail-etransfercontactlog-form><h1>Add contact</h1><span>${realPayment.recipientName}</span><span>wrong@campus.ca</span><button id="fpx-submit-shell-btn">Confirm</button></app-retail-etransfercontactlog-form>`,
    );
    window.document
      .querySelector("button")!
      .addEventListener("click", () => confirms++);
  });
  const pending = injectedBankAction("prepare", realPayment, message);
  await vi.advanceTimersByTimeAsync(15000);
  expect((await pending).status).toBe("error");
  expect(confirms).toBe(0);
});

test("non-Autodeposit contact cannot be saved with missing security details", async () => {
  contactForm();
  const root = window.document.querySelector('[role="main"]')!;
  window.document
    .getElementById("RetailEtransfercontactlogForm_securityAnswer_input")!
    .remove();
  root.insertAdjacentHTML(
    "beforeend",
    '<input id="RetailEtransfercontactlogForm_securityQuestion_input" maxlength="40"><input id="RetailEtransfercontactlogForm_securityAnswer_input" maxlength="25">',
  );
  const continued = vi.spyOn(window.document.querySelector("button")!, "click");
  const pending = injectedBankAction(
    "prepare",
    { ...payment, recipientEmail: "writer@campus.ca" },
    message,
  );
  await vi.advanceTimersByTimeAsync(15000);
  expect((await pending).status).toBe("error");
  expect(continued).not.toHaveBeenCalled();
});

test("navigation preserves an unfinished payment", async () => {
  sendForm(payment.recipientEmail, "45.00");
  await expect(executeBankAction("navigate", payment, message)).rejects.toThrow(
    "unfinished",
  );
  expect(value("RetailEtransfer_paymentAmount_input")).toBe("45.00");
});

test("preset fills only rendered security fields and leaves Autodeposit fields untouched", async () => {
  const preset = {
    question: "Synthetic test question?",
    answer: "test-answer-only",
  };
  sendForm();
  const result = await runBankAction("prepare", payment, message, preset);
  expect(result.status).toBe("filled");
  expect(value("RetailEtransfer_securityAnswer_input")).toBe("secret");
  sendForm();
  window.document
    .getElementById("RetailEtransfer_securityAnswer_input")!
    .remove();
  window.document
    .querySelector('[role="main"]')!
    .insertAdjacentHTML(
      "beforeend",
      '<input id="RetailEtransfer_securityQuestion_input" maxlength="40"><input id="RetailEtransfer_securityAnswer_input" maxlength="25"><input id="RetailEtransfer_confirmSecurityAnswer_input" maxlength="25">',
    );
  expect((await runBankAction("prepare", payment, message)).status).toBe(
    "error",
  );
  expect(value("RetailEtransfer_paymentAmount_input")).toBe("0.00");
  expect(
    (await runBankAction("prepare", payment, message, preset)).status,
  ).toBe("filled");
  expect(value("RetailEtransfer_securityQuestion_input")).toBe(preset.question);
  expect(value("RetailEtransfer_securityAnswer_input")).toBe(preset.answer);
  expect(value("RetailEtransfer_confirmSecurityAnswer_input")).toBe(
    preset.answer,
  );
});

const emptyAccount = {
  accountNumber: "111111110000",
  name: "Test Empty",
  type: "Chequing Account",
};

test("uses the saved preset when an existing contact supplies a question but no answer", async () => {
  sendForm();
  window.document
    .getElementById("RetailEtransfer_securityAnswer_input")!
    .remove();
  window.document
    .querySelector('[role="main"]')!
    .insertAdjacentHTML(
      "beforeend",
      '<input id="RetailEtransfer_securityQuestion_input" maxlength="40" value="Earlier bank question?"><input id="RetailEtransfer_securityAnswer_input" maxlength="25">',
    );
  const preset = {
    question: "Synthetic replacement question?",
    answer: "fixture-answer",
  };
  expect(
    (await runBankAction("fill-payment", payment, message, preset)).status,
  ).toBe("filled");
  expect(value("RetailEtransfer_securityQuestion_input")).toBe(preset.question);
  expect(value("RetailEtransfer_securityAnswer_input")).toBe(preset.answer);
});

test.each(["different-answer", "complete-different-question"])(
  "preserves a completed conflicting security pair (%s)",
  async (conflict) => {
    sendForm();
    window.document
      .getElementById("RetailEtransfer_securityAnswer_input")!
      .remove();
    const preset = { question: "Synthetic question?", answer: "saved-fixture" };
    const bankQuestion =
      conflict === "different-answer"
        ? preset.question
        : "Other bank question?";
    const bankAnswer =
      conflict === "different-answer" ? "typed-fixture" : preset.answer;
    window.document
      .querySelector('[role="main"]')!
      .insertAdjacentHTML(
        "beforeend",
        `<input id="RetailEtransfer_securityQuestion_input" value="${bankQuestion}"><input id="RetailEtransfer_securityAnswer_input" value="${bankAnswer}">`,
      );
    const next = vi.spyOn(window.document.querySelector("button")!, "click");
    const result = await runBankAction("prepare", payment, message, preset);
    expect(result.status).toBe("error");
    expect(value("RetailEtransfer_securityQuestion_input")).toBe(bankQuestion);
    expect(value("RetailEtransfer_securityAnswer_input")).toBe(bankAnswer);
    expect(value("RetailEtransfer_paymentAmount_input")).toBe("0.00");
    expect(next).not.toHaveBeenCalled();
  },
);

test("waits for security answers rebuilt after changing the question and repairs them before Review", async () => {
  sendForm();
  window.document
    .getElementById("RetailEtransfer_securityAnswer_input")!
    .remove();
  window.document
    .querySelector('[role="main"]')!
    .insertAdjacentHTML(
      "beforeend",
      '<input id="RetailEtransfer_securityQuestion_input" maxlength="40"><input id="RetailEtransfer_securityAnswer_input" maxlength="25">',
    );
  const preset = {
    question: "Synthetic delayed question?",
    answer: "fixture-delayed",
  };
  const next = window.document.querySelector("button")!;
  next.disabled = true;
  const attachAnswer = () =>
    window.document
      .getElementById("RetailEtransfer_securityAnswer_input")!
      .addEventListener("input", () => {
        next.disabled = false;
      });
  attachAnswer();
  window.document
    .getElementById("RetailEtransfer_securityQuestion_input")!
    .addEventListener("input", () => {
      setTimeout(() => {
        window.document
          .getElementById("RetailEtransfer_securityAnswer_input")!
          .remove();
        window.document
          .querySelector('[role="main"]')!
          .insertAdjacentHTML(
            "beforeend",
            '<input id="RetailEtransfer_securityAnswer_input" maxlength="25">',
          );
        next.disabled = true;
        attachAnswer();
      }, 500);
    });
  expect(
    (await runBankAction("fill-payment", payment, message, preset)).status,
  ).toBe("filled");
  expect(value("RetailEtransfer_securityAnswer_input")).toBe(preset.answer);
  // Receipt arming can take time. The bank may clear the answer in that interval.
  (
    window.document.getElementById(
      "RetailEtransfer_securityAnswer_input",
    ) as any
  ).value = "";
  next.disabled = true;
  let confirmed = 0;
  next.addEventListener("click", () => {
    expect(value("RetailEtransfer_securityAnswer_input")).toBe(preset.answer);
    paymentReview();
    window.document
      .querySelector("button")!
      .addEventListener("click", () => confirmed++);
  });
  expect(
    (await runBankAction("open-review", payment, message, preset)).status,
  ).toBe("reviewed");
  expect(confirmed).toBe(0);
});

test.each([true, false])(
  "rechecks security widgets rebuilt after amount filling (preset saved: %s)",
  async (saved) => {
    sendForm();
    const preset = {
      question: "Synthetic late question?",
      answer: "late-fixture",
    };
    const continueButton = window.document.querySelector("button")!;
    const amountField = window.document.getElementById(
      "RetailEtransfer_paymentAmount_input",
    )!;
    amountField.addEventListener("input", () => {
      continueButton.disabled = true;
      setTimeout(() => {
        window.document
          .getElementById("RetailEtransfer_securityAnswer_input")
          ?.remove();
        window.document
          .querySelector('[role="main"]')!
          .insertAdjacentHTML(
            "beforeend",
            '<input id="RetailEtransfer_securityQuestion_input" maxlength="40"><input id="RetailEtransfer_securityAnswer_input" maxlength="25">',
          );
        for (const input of window.document.querySelectorAll(
          'input[id*="security"]',
        ))
          input.addEventListener("input", () => {
            continueButton.disabled =
              !value("RetailEtransfer_securityQuestion_input") ||
              !value("RetailEtransfer_securityAnswer_input");
          });
      }, 400);
    });
    const result = await runBankAction(
      "prepare",
      payment,
      message,
      saved ? preset : null,
    );
    expect(result.status).toBe(saved ? "filled" : "error");
    if (saved) {
      expect(value("RetailEtransfer_securityQuestion_input")).toBe(
        preset.question,
      );
      expect(value("RetailEtransfer_securityAnswer_input")).toBe(preset.answer);
      expect(continueButton.disabled).toBe(false);
    } else
      expect(result.message).toContain("needs a security question and answer");
  },
);
const fundedAccount = {
  accountNumber: "111111118874",
  name: "Test Payments",
  type: "Chequing Account",
};
function accountFixture(available = [emptyAccount, fundedAccount]) {
  sendForm();
  const main = window.document.querySelector('[role="main"]')!;
  const counts = {
    selections: 0,
    confirmations: 0,
    cancellations: 0,
    paymentContinues: 0,
    paymentSends: 0,
  };
  const [next, send] = main.querySelectorAll("button");
  next.addEventListener("click", () => counts.paymentContinues++);
  send.addEventListener("click", () => counts.paymentSends++);
  main.insertAdjacentHTML(
    "afterbegin",
    `<box role="button" class="account-card" aria-label="Select source account ${emptyAccount.name} Chequing Account ${emptyAccount.accountNumber} Balance CAD $0.00"><box class="account-header"><h2>${emptyAccount.name}</h2><p>Chequing Account ${emptyAccount.accountNumber}</p></box></box>`,
  );
  const source = main.querySelector(".account-card")!;
  source.addEventListener("click", () => {
    main.setAttribute("aria-hidden", "true");
    window.document.body.insertAdjacentHTML(
      "beforeend",
      `<mat-dialog-container role="dialog"><app-casa-accounts-list><box role="heading" aria-level="1">Select an account</box>${available.map((a) => `<box class="summary-card-inner" role="row" aria-label="${a.name}, ${a.type}, Account number ${a.accountNumber} Not Selected , Available Balance: CAD 250 $">${a.name}</box>`).join("")}<button>Cancel</button><button disabled>Confirm selection</button></app-casa-accounts-list></mat-dialog-container>`,
    );
    const dialog = window.document.querySelector('[role="dialog"]')!;
    const [cancel, confirm] = dialog.querySelectorAll("button");
    let selected = emptyAccount;
    dialog.querySelectorAll('[role="row"]').forEach((row, i) =>
      row.addEventListener("click", () => {
        selected = available[i];
        counts.selections++;
        row.setAttribute(
          "aria-label",
          `${selected.name}, ${selected.type}, Account number ${selected.accountNumber}, Selected, Available Balance: CAD 250 $`,
        );
        confirm.disabled = false;
      }),
    );
    cancel.addEventListener("click", () => {
      counts.cancellations++;
      dialog.remove();
      main.removeAttribute("aria-hidden");
    });
    confirm.addEventListener("click", () => {
      counts.confirmations++;
      dialog.remove();
      main.removeAttribute("aria-hidden");
      source.setAttribute(
        "aria-label",
        `Select source account ${selected.name} Chequing Account ${selected.accountNumber} Balance CAD $250.00`,
      );
      source.querySelector("h2")!.textContent = selected.name;
      source.querySelector("p")!.textContent =
        `${selected.type} ${selected.accountNumber}`;
      // Live Vancity resets these fields when a source account is applied.
      window.document.getElementById(
        "RetailEtransfer_paymentAmount_input",
      )!.outerHTML =
        '<input id="RetailEtransfer_paymentAmount_input" value="0.00">';
      window.document.getElementById(
        "RetailEtransfer_remarks_input",
      )!.outerHTML =
        '<textarea id="RetailEtransfer_remarks_input" maxlength="400"></textarea>';
    });
  });
  return counts;
}

test("reads current and available accounts without selecting one or changing the payment", async () => {
  const counts = accountFixture();
  expect(await runBankAction("current-account", null, "")).toMatchObject({
    status: "account",
    account: emptyAccount,
  });
  const pending = injectedBankAction("list-accounts", null, "");
  await vi.advanceTimersByTimeAsync(15000);
  expect(await pending).toMatchObject({
    status: "accounts",
    accounts: [
      { ...emptyAccount, availableBalance: "250" },
      { ...fundedAccount, availableBalance: "250" },
    ],
  });
  expect(counts).toMatchObject({
    selections: 0,
    confirmations: 0,
    cancellations: 1,
  });
  expect(value("RetailEtransfer_paymentAmount_input")).toBe("0.00");
});

test("selects the exact saved account before filling fields reset by Vancity, without payment Continue or Send", async () => {
  const counts = accountFixture();
  const pending = injectedBankAction(
    "prepare",
    payment,
    message,
    null,
    fundedAccount,
  );
  await vi.advanceTimersByTimeAsync(15000);
  expect((await pending).status).toBe("filled");
  expect(counts).toEqual({
    selections: 1,
    confirmations: 1,
    cancellations: 0,
    paymentContinues: 0,
    paymentSends: 0,
  });
  expect(value("RetailEtransfer_paymentAmount_input")).toBe("45.00");
  expect(value("RetailEtransfer_remarks_input")).toBe(message);
});

test("missing or ambiguous default accounts never select a substitute or write payment fields", async () => {
  for (const available of [
    [emptyAccount],
    [emptyAccount, fundedAccount, fundedAccount],
  ]) {
    const counts = accountFixture(available);
    const pending = injectedBankAction(
      "prepare",
      payment,
      message,
      null,
      fundedAccount,
    );
    await vi.advanceTimersByTimeAsync(15000);
    expect(await pending).toMatchObject({
      status: "error",
      message: expect.stringContaining("not a unique"),
    });
    expect(counts).toMatchObject({
      selections: 0,
      confirmations: 0,
      cancellations: 1,
      paymentContinues: 0,
      paymentSends: 0,
    });
    expect(value("RetailEtransfer_paymentAmount_input")).toBe("0.00");
    expect(value("RetailEtransfer_remarks_input")).toBe("");
  }
});

test("a conflicting payment amount is preserved before any account picker opens", async () => {
  const counts = accountFixture();
  (
    window.document.getElementById("RetailEtransfer_paymentAmount_input") as any
  ).value = "99.00";
  expect(
    await runBankAction("prepare", payment, message, null, fundedAccount),
  ).toMatchObject({
    status: "error",
    message: expect.stringContaining("different amount"),
  });
  expect(counts).toMatchObject({
    selections: 0,
    confirmations: 0,
    cancellations: 0,
  });
  expect(window.document.querySelector('[role="dialog"]')).toBeNull();
  expect(value("RetailEtransfer_paymentAmount_input")).toBe("99.00");
});

test("refuses other origins, nonbank paths and unsupported actions", async () => {
  sendForm();
  window.location.href = "https://my.vancity.com.evil.test/banking/test";
  await expect(
    executeBankAction("fill-payment", payment, message),
  ).rejects.toThrow("Open the Vancity");
  window.location.href = "https://my.vancity.com/public";
  await expect(
    executeBankAction("fill-payment", payment, message),
  ).rejects.toThrow("Open the Vancity");
  window.location.href = "https://my.vancity.com/banking/test";
  await expect(executeBankAction("send", payment, message)).rejects.toThrow(
    "Unsupported",
  );
});
