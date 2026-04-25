import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Planner } from './planner';

describe('Planner', () => {
  let component: Planner;
  let fixture: ComponentFixture<Planner>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Planner],
    }).compileComponents();

    fixture = TestBed.createComponent(Planner);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
