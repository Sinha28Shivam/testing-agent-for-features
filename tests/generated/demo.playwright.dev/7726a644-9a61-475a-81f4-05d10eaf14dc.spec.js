const { test, expect } = require('@playwright/test');

test('TodoMVC navigation and task management', async ({ page }) => {
  // Step 1: Navigate to the TodoMVC application
  await page.goto('https://demo.playwright.dev/todomvc');

  // Step 2: Type 'Homework' in the input field
  await page.getByRole('textbox', { name: 'What needs to be done?' }).fill('Homework');

  // Step 3: Press Enter to submit the task
  await page.keyboard.press('Enter');

  // Step 4: Click the checkbox to mark the 'Homework' task as completed
  await page.getByRole('checkbox', { name: 'Toggle Todo' }).click();

  // Assert that the task is completed
  await expect(page.getByRole('checkbox', { name: 'Toggle Todo' })).toBeChecked();

  // Step 8: Click the checkbox again to mark the 'Homework' task as completed again (no effect)
  await page.getByRole('checkbox', { name: 'Toggle Todo' }).click();

  // Step 9: Type 'Homework' in the input field (Duplicate task, should be added again)
  await page.getByRole('textbox', { name: 'What needs to be done?' }).fill('Homework');

  // Step 10: Press Enter to submit the task
  await page.keyboard.press('Enter');

  // Step 11: Click the checkbox to mark the newly added 'Homework' task as completed
  await page.getByRole('checkbox', { name: 'Toggle Todo' }).nth(1).click();

  // Step 12: Click the checkbox to mark the second 'Homework' task as completed
  await page.getByRole('checkbox', { name: 'Toggle Todo' }).nth(1).click();

  // Assert that the second task is completed
  await expect(page.getByRole('checkbox', { name: 'Toggle Todo' }).nth(1)).toBeChecked();

  // Step 16: Click the delete button to remove the completed 'Homework' task
  await page.getByRole('button', { name: 'Delete' }).click();

  // Assert that the task has been deleted
  await expect(page.getByRole('checkbox', { name: 'Toggle Todo' })).not.toBeVisible();

  // Final assertions to ensure there are no more 'Homework' tasks in the list
  await expect(page.getByText('Homework')).not.toBeVisible();
});