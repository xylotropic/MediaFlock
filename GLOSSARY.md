# MediaFlock

MediaFlock prepares content for social accounts, obtains the owner's final approval, and records delivery and performance.

## Language

**Content Package**:
A collection of material and drafts for one content idea.
_Avoid_: Campaign, post bundle

**Platform Variant**:
A draft prepared for one social account and publication format.
_Avoid_: Generic post, platform copy

**Revision**:
An exact version of a Platform Variant's text, media, privacy and publication settings.
_Avoid_: Mutable draft version

**Approval Request**:
A request for the owner to review an exact Revision, destination and publication time.
_Avoid_: Publication permission

**Final Approval**:
The workspace owner's authorization for the exact content, media, destination, privacy and publication time.
_Avoid_: Agent approval, reviewer sign-off

**Approved Delivery**:
A delivery governed by a Final Approval and its exact publication details.
_Avoid_: Automatically approved post

**Cancellation Request**:
A request to stop a delivery whose final outcome is not yet confirmed.
_Avoid_: Confirmed cancellation

**Confirmed Cancellation**:
Evidence that a delivery will not publish under its existing publication details.
_Avoid_: Cancellation request, deletion acknowledgment

**Metric Observation**:
A measured result for a published post, with its meaning and observation time.
_Avoid_: Estimated result, cumulative snapshot total

**Cloud Tick**:
A bounded cloud run that inspects existing Approved Deliveries and Metric Observations. It cannot give Final Approval or prepare original media.
_Avoid_: Automatic approval, always-on media processing
