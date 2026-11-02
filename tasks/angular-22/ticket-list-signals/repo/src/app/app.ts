import { Component } from '@angular/core';
import { InboxPage } from './inbox/inbox-page';

@Component({
  selector: 'app-root',
  imports: [InboxPage],
  template: '<app-inbox-page />',
})
export class App {}
