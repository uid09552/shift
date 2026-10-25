import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { UserDropdownComponent } from './user-dropdown.component';

describe('UserDropdownComponent', () => {
  it('forgets the employee calendar choice on sign-out, before leaving', () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const component = TestBed.createComponent(UserDropdownComponent).componentInstance;
    localStorage.setItem('employeeCalendar.selection', JSON.stringify({ sub: 'u1', employeeId: 'e1' }));
    const leave = spyOn(component, 'leaveTo');

    component.signOut();

    expect(localStorage.getItem('employeeCalendar.selection')).toBeNull();
    expect(leave).toHaveBeenCalledWith('/logout');
  });
});
