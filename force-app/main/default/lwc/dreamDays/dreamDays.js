import { LightningElement, wire } from 'lwc';
import { gql, graphql, executeMutation } from 'lightning/graphql';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

// Assumed metadata:
// - Object API name: DreamDay__c
// - Date field API name: ItemDate__c
const DREAM_DAYS_QUERY = gql`
    query DreamDaysList($orderBy: DreamDay__c_OrderBy) {
        uiapi {
            query {
                DreamDay__c(first: 200, orderBy: $orderBy) {
                    edges {
                        node {
                            Id
                            Name {
                                value
                            }
                            ItemDate__c {
                                value
                            }
                        }
                    }
                }
            }
        }
    }
`;

const CREATE_DREAM_DAY = gql`
    mutation CreateDreamDay($title: String!, $itemDate: Date!) {
        uiapi {
            DreamDay__cCreate(
                input: { DreamDay__c: { Name: $title, ItemDate__c: $itemDate } }
            ) {
                Record {
                    Id
                }
            }
        }
    }
`;

const DELETE_DREAM_DAY = gql`
    mutation DeleteDreamDay($id: IdOrRef!) {
        uiapi {
            DreamDay__cDelete(input: { Id: $id }) {
                Id
            }
        }
    }
`;

export default class DreamDays extends LightningElement {
    items = [];
    error;
    isLoading = true;

    newTitle = '';
    newItemDate;
    isSaving = false;

    graphqlRefresh;

    wiredResult;
    dateFormatter = new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });

    @wire(graphql, {
        query: DREAM_DAYS_QUERY,
        variables: '$queryVariables'
    })
    wiredDreamDays(result) {
        this.wiredResult = result;
        const { data, error, refresh } = result;
        this.isLoading = false;
        this.graphqlRefresh = refresh;

        if (data) {
            const records = data?.uiapi?.query?.DreamDay__c?.edges ?? [];
            this.items = records
                .map((edge) => {
                    const id = edge.node.Id;
                    const title = edge.node.Name?.value ?? '';
                    const itemDate = edge.node.ItemDate__c?.value;
                    return {
                        id,
                        title,
                        itemDate,
                        itemDateLabel: this.formatDate(itemDate),
                        differenceLabel: this.formatDateDifference(itemDate)
                    };
                })
                .sort((a, b) => new Date(a.itemDate) - new Date(b.itemDate));
            this.error = undefined;
            return;
        }

        if (error) {
            this.items = [];
            this.error = this.reduceErrors(error);
        }
    }

    get queryVariables() {
        return {
            orderBy: {
                ItemDate__c: {
                    order: 'ASC'
                }
            }
        };
    }

    get hasItems() {
        return this.items.length > 0;
    }

    get disableAdd() {
        return this.isSaving || !this.newTitle?.trim() || !this.newItemDate;
    }

    handleTitleChange(event) {
        this.newTitle = event.target.value;
    }

    handleDateChange(event) {
        this.newItemDate = event.target.value;
    }

    async handleAdd() {
        if (this.disableAdd) {
            return;
        }

        this.isSaving = true;
        try {
            await executeMutation({
                query: CREATE_DREAM_DAY,
                variables: {
                    title: this.newTitle.trim(),
                    itemDate: this.newItemDate
                }
            });

            this.newTitle = '';
            this.newItemDate = undefined;
            await this.handleRefresh();

            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Item added',
                    message: 'Dream day item was created.',
                    variant: 'success'
                })
            );
        } catch (mutationError) {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Could not add item',
                    message: this.reduceErrors(mutationError),
                    variant: 'error'
                })
            );
        } finally {
            this.isSaving = false;
        }
    }

    async handleRemove(event) {
        const recordId = event.currentTarget.dataset.id;
        if (!recordId) {
            return;
        }

        this.isSaving = true;
        try {
            const { data, errors } = await executeMutation({
                query: DELETE_DREAM_DAY,
                variables: {
                    id: recordId
                }
            });

            if (errors?.length) {
                console.error('Delete errors:', errors);
            }

            await this.handleRefresh();

            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Item removed',
                    message: 'Dream day item was deleted.',
                    variant: 'success'
                })
            );
        } catch (mutationError) {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Could not remove item',
                    message: this.reduceErrors(mutationError),
                    variant: 'error'
                })
            );
        } finally {
            this.isSaving = false;
        }
    }

    async handleRefresh() {
        return this.graphqlRefresh();
    }

    formatDate(value) {
        if (!value) {
            return 'N/A';
        }
        const dateValue = new Date(value);
        if (Number.isNaN(dateValue.getTime())) {
            return 'N/A';
        }
        return this.dateFormatter.format(dateValue);
    }

    formatDateDifference(value) {
        const targetDate = this.toDateOnly(value);
        if (!targetDate) {
            return 'N/A';
        }

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const isPast = targetDate < today;

        if (targetDate.getTime() === today.getTime()) {
            return 'Today';
        }

        const [start, end] = isPast ? [targetDate, today] : [today, targetDate];
        const diff = this.calendarDiff(start, end);
        const base = `${diff.years} years, ${diff.months} months, ${diff.days} days`;

        return isPast ? `${base} ago` : `In ${base}`;
    }

    toDateOnly(value) {
        if (!value) {
            return null;
        }

        const [year, month, day] = String(value).split('-').map(Number);
        if (!year || !month || !day) {
            return null;
        }

        return new Date(year, month - 1, day);
    }

    calendarDiff(startDate, endDate) {
        let years = endDate.getFullYear() - startDate.getFullYear();
        let months = endDate.getMonth() - startDate.getMonth();
        let days = endDate.getDate() - startDate.getDate();

        if (days < 0) {
            months -= 1;
            const previousMonthDays = new Date(
                endDate.getFullYear(),
                endDate.getMonth(),
                0
            ).getDate();
            days += previousMonthDays;
        }

        if (months < 0) {
            years -= 1;
            months += 12;
        }

        return { years, months, days };
    }

    reduceErrors(errors) {
        const normalized = Array.isArray(errors) ? errors : [errors];
        return normalized
            .filter((error) => !!error)
            .map((error) => {
                if (typeof error === 'string') {
                    return error;
                }
                if (Array.isArray(error.body)) {
                    return error.body.map((issue) => issue.message).join(', ');
                }
                if (error.body?.message) {
                    return error.body.message;
                }
                if (error.message) {
                    return error.message;
                }
                return 'Unknown error';
            })
            .join('; ');
    }
}
