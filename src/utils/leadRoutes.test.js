import {test,expect} from 'vitest';
import {adminPathForView,parseAdminPath} from './adminRoutes';
test('lead list/detail and reports have stable direct URLs',()=>{expect(adminPathForView('lead/:id','123')).toBe('/admin/leads/123');expect(parseAdminPath('/admin/leads/123')).toEqual({view:'lead/:id',param:'123'});expect(adminPathForView('leads')).toBe('/admin/leads');expect(parseAdminPath('/admin/reports')).toEqual({view:'reports',param:null});});
