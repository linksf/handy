import {render,screen,fireEvent} from '@testing-library/react';
import {describe,test,expect,vi} from 'vitest';
import GlobalSearch,{findSearchResults} from './GlobalSearch';
const customers=[{id:'c1',name:'Paul García',phone:'(415) 555-1234',email:'paul@example.com',address:'1219 Lombard St'}];
const jobs=[{id:'j1',customerId:'c1',title:'Assemble patio furniture',status:'Scheduled',date:'2026-10-15'}];
describe('global search',()=>{
  test('finds jobs through customer identity and normalizes accents and phones',()=>{
    expect(findSearchResults(customers,jobs,'garcia').map(r=>r.type)).toEqual(['Job','Customer']);
    expect(findSearchResults(customers,jobs,'4155551234')).toHaveLength(2);
    expect(findSearchResults(customers,jobs,'paul patio').map(r=>r.id)).toEqual(['j1']);
    expect(findSearchResults(customers,jobs,'lombard')).toHaveLength(2);
    expect(findSearchResults(customers,jobs,'')).toEqual([]);
  });
  test('keyboard opens the selected job and clears the search',()=>{
    const nav=vi.fn();render(<GlobalSearch customers={customers} jobs={jobs} nav={nav}/>);
    const input=screen.getByRole('combobox');fireEvent.change(input,{target:{value:'patio'}});
    fireEvent.keyDown(input,{key:'ArrowDown'});fireEvent.keyDown(input,{key:'Enter'});
    expect(nav).toHaveBeenCalledWith('job/:id','j1');expect(input).toHaveValue('');
  });
  test('shows no matches and Escape dismisses results',()=>{
    render(<GlobalSearch customers={customers} jobs={jobs} nav={()=>{}}/>);
    const input=screen.getByRole('combobox');fireEvent.change(input,{target:{value:'missing'}});
    expect(screen.getByText('No matching records.')).toBeInTheDocument();
    fireEvent.keyDown(input,{key:'Escape'});expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

test('finds a lead by service address and brings it back in recent matches', () => {
  window.localStorage?.clear();
  const nav = vi.fn();
  const leads = [{ id: 'l1', name: 'Sam', title: 'Repair door', status: 'active', address: '19 Juniper Lane' }];
  render(<GlobalSearch customers={customers} jobs={jobs} leads={leads} nav={nav} />);
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: '19 juniper' } });
  expect(screen.getByRole('option')).toHaveTextContent('Lead · active');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(nav).toHaveBeenCalledWith('lead/:id', 'l1');
  fireEvent.click(input);
  expect(screen.getByRole('listbox', { name: 'Recent matches' })).toHaveTextContent('19 Juniper Lane');
});
