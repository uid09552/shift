import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Sitebar } from './sitebar';

describe('Sitebar', () => {
  let component: Sitebar;
  let fixture: ComponentFixture<Sitebar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Sitebar],
    }).compileComponents();

    fixture = TestBed.createComponent(Sitebar);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
