import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { AppHeaderComponent } from './app-header.component';

describe('AppHeaderComponent', () => {
  const published = () => document.documentElement.style.getPropertyValue('--app-header-height');
  /** ResizeObserver reports between frames, not synchronously. */
  const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  afterEach(() => document.documentElement.style.removeProperty('--app-header-height'));

  it('publishes its height as --app-header-height and follows a resize', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(AppHeaderComponent);
    document.body.appendChild(fixture.nativeElement); // laid out, so it has a height
    fixture.detectChanges();
    const header = fixture.nativeElement.querySelector('header') as HTMLElement;
    expect(published()).toBe(`${header.offsetHeight}px`);

    header.style.height = '123px';
    await frames();
    expect(published()).toBe('123px');

    fixture.destroy();
    header.style.height = '50px';
    await frames();
    expect(published()).toBe('123px'); // no longer observed
    fixture.nativeElement.remove();
  });
});
