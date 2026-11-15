import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import InvoiceTab from "./InvoiceTab";
vi.mock("../firebase",()=>({functions:{}}));
vi.mock("firebase/functions",()=>({httpsCallable:vi.fn(()=>vi.fn().mockResolvedValue({}))}));
function Harness(){
 const [job,setJob]=useState({id:"job",title:"Repair",amountPaid:0,hours:4,hourlyRate:75,expenses:[{id:"parts",name:"Parts",amount:50,reimbursable:false}]});
 return <InvoiceTab job={job} saveJob={async updates=>setJob(old=>({...old,...updates}))} customer={{name:"Customer"}}/>;
}
test("create another invoice, add independent hours and comp an assigned non-reimbursable expense",async()=>{
 render(<Harness/>);
 fireEvent.change(screen.getByRole("textbox",{name:"New invoice name"}),{target:{value:"Second visit"}});
 fireEvent.click(screen.getByRole("button",{name:"Create invoice"}));
 await screen.findByRole("heading",{name:"Second visit"});
 fireEvent.change(screen.getByRole("textbox",{name:"Item description"}),{target:{value:"Crew"}});
 fireEvent.change(screen.getByRole("spinbutton",{name:"Item hours"}),{target:{value:"2"}});
 fireEvent.change(screen.getByRole("spinbutton",{name:"Item hourly rate"}),{target:{value:"100"}});
 fireEvent.click(screen.getByRole("button",{name:"Add invoice item"}));
 await screen.findByText("Crew (2 hr × $100.00/hr)");
 const select=screen.getByRole("combobox",{name:"Invoice for Parts"});
 const secondId=Array.from(select.options).find(o=>o.text==="Second visit").value;
 fireEvent.change(select,{target:{value:secondId}});
 fireEvent.click(screen.getByRole("button",{name:"Apply line change"}));
 await waitFor(()=>expect(select).not.toBeDisabled());
 fireEvent.click(screen.getByRole("checkbox",{name:"Comp Parts"}));
 fireEvent.click(screen.getByRole("button",{name:"Apply line change"}));
 await waitFor(()=>expect(screen.getByRole("checkbox",{name:"Comp Parts"})).toBeChecked());
 expect(screen.getByText("· Comped")).toBeInTheDocument();
 expect(screen.getByText("$50.00",{selector:"del"})).toBeInTheDocument();
 expect(screen.getByText("$450.00")).toBeInTheDocument();
});
